@echo off
rem Start the editor, finding an interpreter rather than assuming one.
rem
rem `python start.py` is what the documentation said, and on a Windows machine
rem that never installed Python from python.org it prints an advertisement for
rem the Microsoft Store and exits -- `python` there is a stub, not an
rem interpreter. A project with its own virtual environment and a stub on PATH
rem is the normal case, not the broken one, so this looks for a real
rem interpreter instead of leaving you to guess which name works.
rem
rem Type it with the extension: `start.cmd`. Plain `start` is a cmd built-in.

set "PY="
if exist "%~dp0.venv\Scripts\python.exe" set "PY=%~dp0.venv\Scripts\python.exe"
if not defined PY if exist "%~dp0backend\.venv\Scripts\python.exe" set "PY=%~dp0backend\.venv\Scripts\python.exe"
if not defined PY if exist "%~dp0venv\Scripts\python.exe" set "PY=%~dp0venv\Scripts\python.exe"

rem Nothing in the project: try the names, and check each actually runs. The
rem Store stub answers to `python` and fails the moment it is asked to do
rem anything, so "is it on PATH" is not the question.
if not defined PY (
  py -3 -c "import sys" >nul 2>&1 && set "PY=py -3"
)
if not defined PY (
  python3 -c "import sys" >nul 2>&1 && set "PY=python3"
)
if not defined PY (
  python -c "import sys" >nul 2>&1 && set "PY=python"
)

if not defined PY (
  echo.
  echo No Python interpreter found.
  echo.
  echo The editor's backend needs one. Either install Python from python.org,
  echo or create the project's environment:
  echo.
  echo     py -3 -m venv .venv
  echo     .venv\Scripts\pip install -r backend\requirements.txt
  echo.
  echo A graph on its own needs no Python:  node engine\src\main.ts graph.json
  exit /b 1
)

echo Using %PY%
%PY% "%~dp0start.py" %*
exit /b %errorlevel%
