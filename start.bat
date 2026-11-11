@echo off
chcp 65001 >nul
title 生物3D课件 - 本地服务器
echo.
echo  ============================================
echo    基因表达实验室 - 3D生物课件服务器
echo  ============================================
echo.
echo  正在启动服务器...

:: 尝试用 Python 启动
python -m http.server 8080 --bind 0.0.0.0
if %ERRORLEVEL% NEQ 0 (
    echo Python 不可用，请安装 Python 后重试。
    pause
)