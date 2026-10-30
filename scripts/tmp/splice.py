"""Recompone base-completa.sql: encabezado y bloque de super admin actuales + esquema nuevo + demo nueva."""
import sys
from pathlib import Path

old = Path('database/demo/base-completa.sql').read_text(encoding='utf-8')
schema = Path(sys.argv[1]).read_text(encoding='utf-8')
demo = Path('database/demo/datos-demo.sql').read_text(encoding='utf-8')

marker = '/*!50503 SET NAMES utf8mb4 */;'
head = old[: old.index(marker)]
head = head.replace("--    Usuarios por rol (misma contraseña): demo.encargado, demo.cajero,\n--    demo.vendedor, demo.deposito, demo.contador",
                    "--    Usuarios por rol (misma contraseña): demo.encargado, demo.cajero,\n--    demo.vendedor, demo.vendedora, demo.deposito, demo.contador")
positions = []
offset = 0
for line in old.split('\n'):
    if line.startswith('-- ════'):
        positions.append(offset)
    offset += len(line) + 1
admin_start = positions[2]
demo_start = positions[4]
admin = old[admin_start:demo_start]

lines = [l for l in schema.split('\n') if not (l.startswith('/*!') and '@' in l)]
schema_clean = '\n'.join(lines).strip() + '\n\n\n'
assert schema_clean.startswith(marker) or marker in schema_clean, schema_clean[:200]
out = head + schema_clean[schema_clean.index(marker):] + admin + demo
Path('database/demo/base-completa.sql').write_text(out, encoding='utf-8')
print('tablas', schema_clean.count('CREATE TABLE'), 'bytes', len(out.encode()))
