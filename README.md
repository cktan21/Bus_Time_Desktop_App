# Bus_Time_Desktop_App

## Prerequisite
- IDE (Any)
- Node Package Manager (npm)
- Github Desktop (If you prefer else CLI)
- Tauri Perquisites for your OS (https://tauri.app/start/prerequisites/)

## Instructions
> Development
```shell
#Installing RUST
# MAC OS
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh

# Windows Powershell
winget install --id Rustlang.Rustup

# Installing Bun 
npm install -g bun

cd SMRT_timing_app
bun install
bun run tauri dev #for desktop app dev
bun run tauri android init #for andriod dev
```