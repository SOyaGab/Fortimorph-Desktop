@echo off
echo ========================================
echo FortiMorph Cross-Platform Build Script
echo ========================================
echo.
echo This script will build FortiMorph for:
echo - Windows (x64)
echo - macOS (x64 + ARM64)
echo - Linux (AppImage + .deb)
echo.
echo Build artifacts will be in the 'dist' folder
echo ========================================
echo.

:: Check if node_modules exists
if not exist "node_modules" (
    echo ERROR: node_modules not found!
    echo Please run: npm install
    pause
    exit /b 1
)

echo Step 1: Building renderer (React app)...
call npm run build:renderer
if errorlevel 1 (
    echo ERROR: Renderer build failed!
    pause
    exit /b 1
)

echo.
echo Step 2: Building for all platforms...
echo This may take several minutes...
echo.

call npm run dist:all

if errorlevel 1 (
    echo.
    echo ERROR: Build failed!
    echo Check the error messages above.
    pause
    exit /b 1
)

echo.
echo ========================================
echo BUILD SUCCESSFUL!
echo ========================================
echo.
echo Build artifacts created in 'dist' folder:
echo.
dir dist\*.exe 2>nul
dir dist\*.dmg 2>nul
dir dist\*.AppImage 2>nul
dir dist\*.deb 2>nul
echo.
echo ========================================
echo Next Steps:
echo 1. Check the 'dist' folder for installers
echo 2. Show these files to your professor
echo 3. Demonstrate the different formats
echo ========================================
pause
