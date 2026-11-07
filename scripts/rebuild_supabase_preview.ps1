$ErrorActionPreference = "Stop"

$pythonExe = Join-Path $PSScriptRoot "..\.venv\Scripts\python.exe"
$pythonExe = [System.IO.Path]::GetFullPath($pythonExe)

if (-not (Test-Path -LiteralPath $pythonExe -PathType Leaf)) {
    throw "Project virtual-environment Python was not found."
}

$preflightCode = @'
import os
import re
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

EXPECTED_PROJECT_REF = "pxiwoowpoewxvnsjwfdw"
EXPECTED_REVISION = "9e45f7e7aa32"
APPLICATION_TABLES = [
    "users",
    "appointments",
    "credentials",
    "mentor_availability",
    "mentor_unavailable_dates",
    "role_applications",
    "messages",
    "reports",
]

def fail(message):
    raise SystemExit(message)

if len(sys.argv) != 2:
    fail("Preflight failed: expected exactly one phase argument.")
phase = sys.argv[1]
if phase not in ("before-stamp", "after-stamp", "after-upgrade"):
    fail("Preflight failed: unknown phase.")

database_url = os.environ.get("DATABASE_URL")
if not database_url:
    fail("Preflight failed: DATABASE_URL is not set.")

try:
    url = make_url(database_url)
except Exception:
    fail("Preflight failed: DATABASE_URL is not a valid SQLAlchemy URL.")

# Match PostgreSQL URL normalization in the project's config.py.
if url.drivername in ("postgres", "postgresql", "postgresql+psycopg2"):
    url = url.set(drivername="postgresql+psycopg")
elif url.drivername != "postgresql+psycopg":
    fail("Preflight failed: DATABASE_URL is not a supported PostgreSQL URL.")

# Validate the recognized Supabase URL forms by component. Pooler URLs use
# a shared pooler host and project-scoped username; direct URLs use the
# project reference in the db.<ref>.supabase.co hostname.
host = (url.host or "").lower()
username = url.username or ""
pooler_host = re.fullmatch(r"aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com", host)
direct_host = host == f"db.{EXPECTED_PROJECT_REF}.supabase.co"
if pooler_host:
    if username != f"postgres.{EXPECTED_PROJECT_REF}":
        fail("Preflight failed: pooler URL is not for the expected Development project.")
elif direct_host:
    if username != "postgres":
        fail("Preflight failed: direct URL has an unexpected database role.")
else:
    fail("Preflight failed: URL does not match a supported Development Supabase format.")

try:
    engine = create_engine(url, pool_pre_ping=True)
except Exception:
    fail("Preflight failed: could not initialize the database connection.")

try:
    with engine.connect() as connection:
        state = connection.execute(text("""
            SELECT
                current_database() AS database_name,
                current_schema() AS current_schema,
                current_schemas(false) AS effective_schemas,
                to_regclass('public.alembic_version') AS alembic_version
        """)).mappings().one()

        if state["database_name"] != "postgres":
            fail("Preflight failed: unexpected database name.")
        if state["current_schema"] != "public":
            fail("Preflight failed: current schema is not public.")
        if "public" not in state["effective_schemas"]:
            fail("Preflight failed: public is not in the effective search path.")
        if state["alembic_version"] is None:
            fail("Preflight failed: public.alembic_version does not exist.")

        revisions = connection.execute(text("""
            SELECT version_num
            FROM public.alembic_version
            ORDER BY version_num
        """)).scalars().all()

        # Match expected table names and related table-prefixed indexes or
        # sequences, as well as the explicitly named meeting-room index.
        conflicts = connection.execute(text("""
            SELECT c.relname, c.relkind
            FROM pg_class AS c
            JOIN pg_namespace AS n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relkind IN ('r', 'p', 'i', 'I', 'S')
              AND (
                    c.relname = ANY(CAST(:names AS text[]))
                    OR c.relname = 'uq_appointments_meeting_room'
                    OR EXISTS (
                        SELECT 1
                        FROM unnest(CAST(:names AS text[])) AS app(name)
                        WHERE left(c.relname, length(app.name) + 1) = app.name || '_'
                           OR left(c.relname, length('ix_' || app.name) + 1) = 'ix_' || app.name || '_'
                    )
              )
            ORDER BY c.relname
        """), {"names": APPLICATION_TABLES}).all()

        existing_tables = connection.execute(text("""
            SELECT c.relname
            FROM pg_class AS c
            JOIN pg_namespace AS n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relkind IN ('r', 'p')
              AND c.relname = ANY(CAST(:names AS text[]))
            ORDER BY c.relname
        """), {"names": APPLICATION_TABLES}).scalars().all()

        if phase == "before-stamp":
            if revisions != [EXPECTED_REVISION]:
                fail("Preflight failed: Alembic revision is not exactly the expected current head.")
            if conflicts:
                fail("Preflight failed: application tables, indexes, or sequences already exist in public.")
        elif phase == "after-stamp":
            if revisions:
                fail("Preflight failed: Alembic revision table is not empty after stamping base.")
            if conflicts:
                fail("Preflight failed: application tables, indexes, or sequences exist before upgrade.")
        else:
            if revisions != [EXPECTED_REVISION]:
                fail("Verification failed: Alembic revision is not exactly the expected head.")
            missing_tables = sorted(set(APPLICATION_TABLES) - set(existing_tables))
            if missing_tables:
                fail("Verification failed: one or more expected application tables are missing.")

        print(f"{phase} check passed.")
        print(f"Database: {state['database_name']}")
        print(f"Schema: {state['current_schema']}")
        print(f"Effective schemas: {state['effective_schemas']}")
        print(f"Alembic revisions: {revisions}")
        print(f"Application tables found: {existing_tables}")
        if phase in ("before-stamp", "after-stamp"):
            print("Conflicting application tables, indexes, or sequences: none")
except SystemExit:
    raise
except Exception:
    # Avoid allowing driver exceptions to echo connection details.
    fail("Preflight failed while checking the database; connection details were suppressed.")
finally:
    engine.dispose()
'@

function Invoke-WithSecurePreviewDatabase {
    param([scriptblock]$Action)

    $hadDatabaseUrl = Test-Path Env:DATABASE_URL
    $previousDatabaseUrl = [Environment]::GetEnvironmentVariable("DATABASE_URL", "Process")
    $secureUrl = Read-Host "Enter the Vercel Preview DATABASE_URL for the Development project" -AsSecureString
    $urlPointer = [IntPtr]::Zero

    try {
        $urlPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUrl)
        $env:DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($urlPointer)

        $confirmation = Read-Host 'Type REBUILD DEVELOPMENT DATABASE to continue'
        if ($confirmation -cne "REBUILD DEVELOPMENT DATABASE") {
            throw "Confirmation did not match; no database changes were made."
        }

        & $Action
    }
    finally {
        if ($hadDatabaseUrl) {
            $env:DATABASE_URL = $previousDatabaseUrl
        }
        else {
            Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
        }

        if ($urlPointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($urlPointer)
        }
        $secureUrl.Dispose()
    }
}

function Invoke-CheckedNativeCommand {
    param(
        [scriptblock]$Command,
        [string]$FailureMessage
    )

    $previousErrorActionPreference = $ErrorActionPreference

    try {
        # Windows PowerShell can treat native stderr as an error record.
        # Keep such records non-terminating so both output streams remain
        # visible, then rely on the native process exit code.
        $ErrorActionPreference = "Continue"
        & $Command
        $commandExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    if ($null -eq $commandExitCode -or $commandExitCode -ne 0) {
        throw $FailureMessage
    }
}

Invoke-WithSecurePreviewDatabase {
    $temporaryPythonFile = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::ChangeExtension([System.IO.Path]::GetRandomFileName(), ".py"))

    try {
        $utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
        [System.IO.File]::WriteAllText($temporaryPythonFile, $preflightCode, $utf8WithoutBom)

        Invoke-CheckedNativeCommand {
            & $pythonExe $temporaryPythonFile "before-stamp"
        } "Pre-stamp check failed; stopping before stamp."

        Invoke-CheckedNativeCommand {
            & $pythonExe -m flask --app app db stamp base
        } "Stamp command failed; stopping before upgrade."

        Invoke-CheckedNativeCommand {
            & $pythonExe $temporaryPythonFile "after-stamp"
        } "Post-stamp check failed; stopping before upgrade."

        Invoke-CheckedNativeCommand {
            & $pythonExe -m flask --app app db upgrade
        } "Upgrade command failed."

        Invoke-CheckedNativeCommand {
            & $pythonExe $temporaryPythonFile "after-upgrade"
        } "Post-upgrade verification failed."
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPythonFile) {
            Remove-Item -LiteralPath $temporaryPythonFile -Force
        }
    }
}
