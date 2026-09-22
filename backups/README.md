# Respaldos automáticos

Acá van a ir apareciendo, solos, los respaldos semanales completos de la
base de datos (ver `.github/workflows/backup.yml`). Cada archivo es un
`.json` con la fecha en el nombre, en el mismo formato que "Exportar copia
completa" de la app.

**Para restaurar uno:** descargalo y usalo con el botón "Importar copia
completa" en la app, pestaña Configuración.

Se conservan los últimos 12 (aproximadamente 3 meses); los más viejos se
van borrando solos para no acumular archivos de más.
