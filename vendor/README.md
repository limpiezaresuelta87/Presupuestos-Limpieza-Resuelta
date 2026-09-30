# Librerías vendorizadas

Estos 4 archivos son copias locales, descargadas una sola vez desde el
registro oficial de npm (`registry.npmjs.org`, no de cdnjs ni jsDelivr),
de las librerías que usa la app para leer Excel, generar PDF y dibujar
gráficos:

| Archivo                             | Librería        | Versión |
|--------------------------------------|-----------------|---------|
| `xlsx.full.min.js`                   | SheetJS (xlsx)  | 0.18.5  |
| `jspdf.umd.min.js`                   | jsPDF           | 2.5.1   |
| `jspdf.plugin.autotable.min.js`      | jsPDF-AutoTable | 3.8.2   |
| `chart.umd.js`                       | Chart.js        | 4.4.4   |

## Por qué están acá y no en un CDN

En septiembre de 2026, `cdnjs.cloudflare.com` dejó de tener publicada la
versión de Chart.js que usaba la app (le devolvía 404), y eso rompió los
gráficos de la sección Informes sin ningún aviso claro. Para que esto no
vuelva a pasar con ninguna librería -- ni por un CDN que borra versiones
viejas, ni por un corte de red hacia un proveedor externo -- las 4 viven
ahora adentro del propio repositorio. La app ya no depende de que ningún
servicio externo esté funcionando ese día para poder leer un Excel,
generar un PDF o mostrar un gráfico.

Firebase (`firebase-app-compat.js`, `firebase-auth-compat.js`,
`firebase-firestore-compat.js`) se dejó como está, cargándose desde
`gstatic.com` (el CDN oficial de Google) -- ese sí hace falta que llegue
por internet siempre, porque es lo que conecta con la base de datos real;
vendorizar solo el archivo no lo haría funcionar offline de verdad.

## Cómo actualizar una versión más adelante

No hace falta tocar nada salvo que realmente se quiera subir de versión
alguna de estas librerías. Para hacerlo:

```bash
npm pack <paquete>@<version>
tar -xzf <paquete>-<version>.tgz package/dist/<archivo>
cp package/dist/<archivo> vendor/<archivo>
```

Después actualizar la lista `APP_SHELL` en `service-worker.js` solo si
cambia el NOMBRE del archivo (no hace falta si el nombre queda igual --
el propio `CACHE_VERSION` del service worker ya fuerza a todos los
navegadores a bajar la versión nueva en el próximo deploy).
