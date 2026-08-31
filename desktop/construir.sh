#!/usr/bin/env bash
# Construir el instalador de Windows. Tres pasos, y el orden importa.
#
# POR QUE NO ES UN SOLO `electron-builder --win`:
# electron-builder se baja un paquete de firma que trae enlaces simbolicos de macOS
# (libcrypto.dylib). Windows no deja crearlos salvo con el MODO DESARROLLADOR activado
# o como administrador, asi que la construccion revienta ANTES de marcar el .exe — y
# entonces el ejecutable se queda diciendo "Electron" en la barra de tareas y en el
# administrador de tareas, que es lo ultimo que quieres en el ordenador de un
# restaurante.
#
# Rodeo: se construye sin firmar, se marca el .exe a mano con el mismo `rcedit` que
# usaria electron-builder, y se empaqueta con `--prepackaged` para que no lo vuelva a
# tocar. Si algun dia se activa el modo desarrollador, esto sigue funcionando igual.
set -e
cd "$(dirname "$0")"

RC=$(find "$LOCALAPPDATA/electron-builder/Cache/winCodeSign" -name "rcedit-x64.exe" 2>/dev/null | head -1)
[ -z "$RC" ] && { echo "No encuentro rcedit. Lanza una vez 'npx electron-builder --win --dir' para que se baje."; exit 1; }

echo "1/3  construyendo la aplicacion..."
npx electron-builder --win --dir --config.win.signAndEditExecutable=false

echo "2/3  marcando el ejecutable (para que NO ponga 'Electron')..."
VER=$(node -p "require('./package.json').version")
"$RC" "dist/win-unpacked/Pidoo Negocios.exe" \
  --set-icon "dist/.icon-ico/icon.ico" \
  --set-version-string "ProductName" "Pidoo Negocios" \
  --set-version-string "FileDescription" "Pidoo Negocios" \
  --set-version-string "CompanyName" "Rogotech" \
  --set-version-string "LegalCopyright" "Rogotech" \
  --set-version-string "InternalName" "Pidoo Negocios" \
  --set-version-string "OriginalFilename" "Pidoo Negocios.exe" \
  --set-file-version "$VER" --set-product-version "$VER"

echo "3/3  empaquetando el instalador..."
npx electron-builder --win nsis --prepackaged dist/win-unpacked --publish never \
  --config.win.signAndEditExecutable=false

echo
echo "Listo: dist/pidoo-negocios-$VER-instalador.exe"
