-- ═══════════════════════════════════════════════════════════════════════════
--  BASE COMPLETA · ERP Comercio (esquema + administrador + datos de demostración)
--
--  ⚠ BORRA Y RECREA TODAS LAS TABLAS de la base `sistema_comercio`.
--    Usar solo en desarrollo / pruebas. NO ejecutar en producción.
--
--  Ejecución (PowerShell, desde la carpeta del backend):
--    mysql -u root -p --default-character-set=utf8mb4 -e "source database/demo/base-completa.sql"
--
--  Acceso al sistema:
--    Usuario administrador:  admin            Contraseña: Admin-Comercio-2026!
--    Usuarios por rol (misma contraseña): demo.encargado, demo.cajero,
--    demo.vendedor, demo.deposito, demo.contador
--    ➜ Cambiá la contraseña del administrador después de ingresar.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE DATABASE IF NOT EXISTS `sistema_comercio` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `sistema_comercio`;
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET FOREIGN_KEY_CHECKS = 0;

