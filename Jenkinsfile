pipeline {
    agent any   // built-in Windows node

    environment {
        NUITKA_ALLOW_DOWNLOADING = '1'
    }

    options {
        timeout(time: 60, unit: 'MINUTES')
    }

    stages {
        stage('Setup Python 3.10') {
            steps {
                // If you have a specific Python path, adjust this
                bat 'python --version'
                bat 'python -m pip install --upgrade pip'
            }
        }

        stage('Setup Node.js') {
            steps {
                // Node already installed on the machine
                bat 'node -v'
            }
        }

        stage('Debug workspace') {
            steps {
                bat '''
                    echo Current directory: %CD%
                    dir
                '''
            }
        }

        stage('Run setup.bat (Windows)') {
            steps {
                bat '''
                    echo Looking for setup.bat in %CD%
                    dir setup.bat
                    if not exist setup.bat (
                        echo ERROR: setup.bat not found in workspace
                        exit /b 1
                    )
                    call setup.bat
                '''
            }
        }

        stage('Prepare frontend/backend') {
            steps {
                bat '''
                    REM Remove frontend\\node_modules like: rm -rf frontend/node_modules
                    if exist frontend\\node_modules (
                        rmdir /s /q frontend\\node_modules
                    )

                    REM Move backend\\web -> .\\web like: mv backend/web ./web
                    if exist backend\\web (
                        if exist web rmdir /s /q web
                        move backend\\web web
                    )
                '''
            }
        }

        stage('Create cache folders (Nuitka & pip)') {
            steps {
                bat '''
                    REM Rough equivalent of caching dirs; actual cache reuse requires shared dirs
                    mkdir "%APPDATA%\\Nuitka" 2>nul
                    mkdir "%LocalAppData%\\pip\\Cache" 2>nul
                '''
            }
        }

        stage('Install Nuitka') {
            steps {
                bat '''
                    python -m pip install nuitka
                '''
            }
        }

        stage('Install Python dependencies') {
            steps {
                bat '''
                    python -m pip install -r requirements.txt
                    python -m pip install "pythonnet==3.0.5" "pywebview==6.0"
                '''
            }
        }

        stage('Find Windows package paths') {
            steps {
                script {
                    def output = bat(
                        script: '''
                            @echo off
                            for /f "delims=" %%a in ('python -c "import pythonnet, pathlib; print(pathlib.Path(pythonnet.__file__).parent / 'runtime')"' ) do set PYTHONNET_RUNTIME=%%a
                            for /f "delims=" %%a in ('python -c "import webview, pathlib; print(pathlib.Path(webview.__file__).parent / 'lib')"' ) do set PYWEBVIEW_LIB=%%a

                            echo PYTHONNET_RUNTIME=%PYTHONNET_RUNTIME%
                            echo PYWEBVIEW_LIB=%PYWEBVIEW_LIB%
                        ''',
                        returnStdout: true
                    ).trim()

                    output.split('\\r?\\n').each { line ->
                        if (line.startsWith('PYTHONNET_RUNTIME=')) {
                            env.PYTHONNET_RUNTIME = line.substring('PYTHONNET_RUNTIME='.length())
                        }
                        if (line.startsWith('PYWEBVIEW_LIB=')) {
                            env.PYWEBVIEW_LIB = line.substring('PYWEBVIEW_LIB='.length())
                        }
                    }

                    echo "Using pythonnet runtime from: ${env.PYTHONNET_RUNTIME}"
                    echo "Using pywebview lib from: ${env.PYWEBVIEW_LIB}"
                }
            }
        }

        stage('Build with Nuitka (Windows)') {
            steps {
                bat '''
                    python -m nuitka ^
                        --mode=standalone ^
                        --assume-yes-for-downloads ^
                        --include-package-data=webview ^
                        --include-package-data=pythonnet ^
                        --include-data-dir=".=." ^
                        backend\\main.py
                '''
            }
        }

        stage('Apply Windows post-build fixes') {
            steps {
                bat """
                    @echo off
                    set DIST_DIR=
                    for /d %%d in (*.dist) do set DIST_DIR=%%d

                    if "%DIST_DIR%"=="" (
                        echo No standalone output folder found
                        exit /b 1
                    )

                    echo Using dist folder: %DIST_DIR%

                    REM Ensure webview\\\\lib exists
                    mkdir "%DIST_DIR%\\webview\\\\lib" 2>nul

                    REM Copy Python.Runtime.dll from pythonnet runtime
                    copy "%PYTHONNET_RUNTIME%\\Python.Runtime.dll" "%DIST_DIR%" /Y

                    REM Copy pywebview native libs into webview\\\\lib
                    xcopy "%PYWEBVIEW_LIB%\\*" "%DIST_DIR%\\webview\\\\lib" /E /I /Y
                """
            }
        }
    }

    post {
        success {
            // Equivalent to upload-artifact for *.dist/**
            archiveArtifacts artifacts: '*.dist/**', allowEmptyArchive: false
            echo 'Nebulus Launch Pad Windows standalone build completed and artifacts archived.'
        }
        failure {
            echo 'Build failed; check console output.'
        }
        always {
            cleanWs()
        }
    }
}
