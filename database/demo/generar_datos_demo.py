#!/usr/bin/env python3
"""
Genera database/demo/datos-demo.sql: una empresa de ejemplo con 4 locales + depósito, catálogo,
clientes, proveedores, 90 días de ventas, cajas abiertas, compras, transferencias y promociones.

Uso:  python3 database/demo/generar_datos_demo.py
Los datos son ficticios. Las fechas se calculan al ejecutar el SQL (siempre quedan "recientes").
"""
from __future__ import annotations

import hashlib
import json
import random
import uuid
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

rng = random.Random(20261011)
OUT = Path(__file__).with_name("datos-demo.sql")

D = Decimal
CENT = D("0.01")


def uid() -> str:
    return str(uuid.UUID(int=rng.getrandbits(128), version=4))


def money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def fp(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def q(value) -> str:
    """Literal SQL."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, Decimal)):
        return str(value)
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, Raw):
        return value.sql
    text = str(value).replace("\\", "\\\\").replace("'", "''")
    return f"'{text}'"


class Raw:
    def __init__(self, sql: str):
        self.sql = sql


def at(seconds_from_today_midnight: int) -> Raw:
    """Instante UTC relativo a la medianoche de hoy en Argentina (@base)."""
    return Raw(f"TIMESTAMPADD(SECOND,{seconds_from_today_midnight},@base)")


def at_past(seconds_from_today_midnight: int, rank: int) -> Raw:
    """Igual que at() pero nunca en el futuro (ventas de hoy)."""
    return Raw(f"LEAST(TIMESTAMPADD(SECOND,{seconds_from_today_midnight},@base),TIMESTAMPADD(SECOND,{-(rank * 300 + 120)},UTC_TIMESTAMP(6)))")


def day_date(days_offset: int) -> Raw:
    return Raw(f"DATE_ADD(@today, INTERVAL {days_offset} DAY)")


lines: list[str] = []


def emit(sql: str = "") -> None:
    lines.append(sql)


def insert(table: str, columns: list[str], rows: list[list], batch: int = 250) -> None:
    for start in range(0, len(rows), batch):
        chunk = rows[start : start + batch]
        values = ",\n".join("(" + ",".join(q(v) for v in row) + ")" for row in chunk)
        emit(f"INSERT INTO `{table}` (`" + "`,`".join(columns) + f"`) VALUES\n{values};")


# ── Identificadores fijos ───────────────────────────────────────
TENANT = "9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f"
ACTOR = Raw("@admin_id")

BRANCHES = [
    # id, code, name, address, phone, sells, weight
    (uid(), "CENTRAL", "Casa Central", "Av. Colón 1250, Córdoba", "351 422-1000", True, 1.35),
    (uid(), "NVA-CBA", "Nueva Córdoba", "Bv. San Juan 455, Córdoba", "351 422-2000", True, 1.0),
    (uid(), "VILLA-A", "Villa Allende", "Av. Goycoechea 820, Villa Allende", "3543 43-3000", True, 0.8),
    (uid(), "RIO-IV", "Río Cuarto", "Constitución 640, Río Cuarto", "358 462-4000", True, 0.7),
    (uid(), "DEPOSITO", "Depósito central", "Ruta 9 km 695, Córdoba", "351 422-5000", False, 0.0),
]
STORES = [b for b in BRANCHES if b[5]]
DEPOT = BRANCHES[4]

# sku, ean, nombre, rubro, marca, unidad, iva, tratamiento, precio final, costo sin IVA, popularidad
PRODUCTS_RAW = [
    ("ALM-001", "7799001000011", "Yerba mate suave 1 kg", "Almacén", "Del Litoral", "UNIT", 21, "TAXED", 4890, 3150, 10),
    ("ALM-002", "7799001000028", "Yerba mate con palo 500 g", "Almacén", "Del Litoral", "UNIT", 21, "TAXED", 2690, 1720, 7),
    ("ALM-003", "7799001000035", "Aceite de girasol 1,5 l", "Almacén", "Cocinera Sur", "UNIT", 21, "TAXED", 3650, 2310, 8),
    ("ALM-004", "7799001000042", "Arroz largo fino 1 kg", "Almacén", "Campo Verde", "UNIT", 10.5, "TAXED", 1890, 1290, 8),
    ("ALM-005", "7799001000059", "Fideos tallarines 500 g", "Almacén", "La Nonna", "UNIT", 10.5, "TAXED", 1290, 820, 9),
    ("ALM-006", "7799001000066", "Azúcar común 1 kg", "Almacén", "Ingenio Norte", "UNIT", 10.5, "TAXED", 1450, 990, 7),
    ("ALM-007", "7799001000073", "Harina 000 1 kg", "Almacén", "Molino Pampa", "UNIT", 10.5, "TAXED", 1150, 760, 6),
    ("ALM-008", "7799001000080", "Café molido 500 g", "Almacén", "Tostadero Andino", "UNIT", 21, "TAXED", 8990, 5650, 4),
    ("ALM-009", "7799001000097", "Galletitas de agua 3 x 100 g", "Almacén", "Panificadora Sur", "UNIT", 21, "TAXED", 1590, 980, 8),
    ("ALM-010", "7799001000103", "Dulce de leche 400 g", "Almacén", "Tambo Norte", "UNIT", 21, "TAXED", 2490, 1580, 6),
    ("ALM-011", "7799001000110", "Mermelada de durazno 454 g", "Almacén", "Huerta Andina", "UNIT", 21, "TAXED", 2190, 1360, 3),
    ("ALM-012", "7799001000127", "Puré de tomate 520 g", "Almacén", "Huerta Andina", "UNIT", 21, "TAXED", 990, 610, 7),
    ("LAC-001", "7799002000010", "Leche entera larga vida 1 l", "Lácteos", "Tambo Norte", "UNIT", 10.5, "TAXED", 1490, 1020, 10),
    ("LAC-002", "7799002000027", "Yogur bebible frutilla 1 l", "Lácteos", "Tambo Norte", "UNIT", 21, "TAXED", 2290, 1460, 6),
    ("LAC-003", "7799002000034", "Queso cremoso por kg", "Lácteos", "Tambo Norte", "KG", 21, "TAXED", 9890, 6300, 4),
    ("LAC-004", "7799002000041", "Manteca 200 g", "Lácteos", "Tambo Norte", "UNIT", 21, "TAXED", 2650, 1690, 4),
    ("BEB-001", "7799003000019", "Gaseosa cola 2,25 l", "Bebidas", "Burbuja", "UNIT", 21, "TAXED", 3290, 2020, 9),
    ("BEB-002", "7799003000026", "Agua mineral sin gas 2 l", "Bebidas", "Manantial", "UNIT", 21, "TAXED", 1390, 820, 8),
    ("BEB-003", "7799003000033", "Jugo de naranja 1 l", "Bebidas", "Huerta Andina", "UNIT", 21, "TAXED", 1990, 1240, 5),
    ("BEB-004", "7799003000040", "Vino tinto Malbec 750 ml", "Bebidas", "Bodega Los Andes", "UNIT", 21, "TAXED", 6490, 3900, 4),
    ("BEB-005", "7799003000057", "Cerveza rubia lata 473 ml", "Bebidas", "Cervecería Sierra", "UNIT", 21, "TAXED", 1690, 1010, 7),
    ("LIM-001", "7799004000018", "Detergente concentrado 750 ml", "Limpieza", "Brillo", "UNIT", 21, "TAXED", 2350, 1420, 6),
    ("LIM-002", "7799004000025", "Lavandina 2 l", "Limpieza", "Brillo", "UNIT", 21, "TAXED", 1490, 880, 6),
    ("LIM-003", "7799004000032", "Jabón en polvo 3 kg", "Limpieza", "Espuma", "UNIT", 21, "TAXED", 11890, 7400, 3),
    ("LIM-004", "7799004000049", "Papel higiénico 4 x 30 m", "Limpieza", "Suave", "PACK", 21, "TAXED", 3190, 1960, 7),
    ("LIM-005", "7799004000056", "Esponja doble uso x 3", "Limpieza", "Brillo", "PACK", 21, "TAXED", 1290, 690, 4),
    ("PER-001", "7799005000017", "Shampoo 400 ml", "Perfumería", "Natura Sur", "UNIT", 21, "TAXED", 4590, 2800, 3),
    ("PER-002", "7799005000024", "Jabón de tocador x 3", "Perfumería", "Natura Sur", "PACK", 21, "TAXED", 2290, 1380, 4),
    ("PER-003", "7799005000031", "Pasta dental 90 g", "Perfumería", "Sonrisa", "UNIT", 21, "TAXED", 2190, 1300, 4),
    ("PER-004", "7799005000048", "Desodorante aerosol 150 ml", "Perfumería", "Natura Sur", "UNIT", 21, "TAXED", 3890, 2350, 3),
    ("LIB-001", "9789870000011", "Libro de recetas criollas", "Librería", "Editorial Sur", "UNIT", 0, "EXEMPT", 15900, 9800, 1),
    ("LIB-002", "7799006000016", "Cuaderno tapa dura 84 hojas", "Librería", "Escolar", "UNIT", 21, "TAXED", 3490, 2050, 2),
    ("FRE-001", "2000001000017", "Pan francés por kg", "Panadería", "Elaboración propia", "KG", 10.5, "TAXED", 2900, 1500, 8),
    ("FRE-002", "2000001000024", "Medialunas x docena", "Panadería", "Elaboración propia", "PACK", 10.5, "TAXED", 6500, 3100, 5),
    # Sin ventas recientes: aparecen en "mercadería sin rotación".
    ("ALM-090", "7799001000905", "Aceite de oliva extra virgen 500 ml", "Almacén", "Olivares del Sol", "UNIT", 21, "TAXED", 12900, 8200, 0),
    ("LIM-090", "7799004000902", "Limpiador de vidrios 500 ml", "Limpieza", "Brillo", "UNIT", 21, "TAXED", 2890, 1750, 0),
    ("PER-090", "7799005000901", "Crema corporal 250 ml", "Perfumería", "Natura Sur", "UNIT", 21, "TAXED", 5990, 3600, 0),
]

PRODUCTS = []
for row in PRODUCTS_RAW:
    sku, ean, name, cat, brand, unit, rate, treat, price, cost, pop = row
    PRODUCTS.append(
        dict(id=uid(), sku=sku, ean=ean, name=name, cat=cat, brand=brand, unit=unit, rate=D(str(rate)), treat=treat,
             price=D(price), cost=D(cost), pop=pop)
    )

# Clientes y proveedores (ficticios). CUIT con dígito verificador válido.


def cuit(prefix: str, body: int) -> str:
    base = f"{prefix}{body:08d}"
    weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
    total = sum(int(d) * w for d, w in zip(base, weights))
    mod = 11 - total % 11
    check = 0 if mod == 11 else 9 if mod == 10 else mod
    return base + str(check)


FIRST = ["María", "Juan", "Lucía", "Martín", "Sofía", "Diego", "Valentina", "Pablo", "Camila", "Nicolás", "Julieta", "Federico",
         "Agustina", "Santiago", "Florencia", "Matías", "Carolina", "Tomás", "Paula", "Gonzalo", "Romina", "Leandro", "Micaela",
         "Facundo", "Natalia", "Ezequiel", "Daniela", "Hernán", "Belén", "Ignacio"]
LAST = ["Gómez", "Rodríguez", "Fernández", "López", "Martínez", "Pérez", "García", "Sánchez", "Romero", "Sosa", "Torres",
        "Álvarez", "Ruiz", "Ramírez", "Flores", "Benítez", "Acosta", "Medina", "Herrera", "Aguirre", "Pereyra", "Giménez",
        "Molina", "Castro", "Ortiz", "Silva", "Núñez", "Luna", "Juárez", "Cabrera"]

CUSTOMERS = []
for i in range(30):
    first, last = FIRST[i], LAST[(i * 7) % 30]
    kind = "MONO" if i % 9 == 0 else "CF"
    CUSTOMERS.append(dict(
        id=uid(), first=first, last=last,
        doc_type=86 if kind == "MONO" else 96,
        doc=cuit("27" if i % 2 == 0 else "20", 30_000_000 + i * 137_911) if kind == "MONO" else str(28_000_000 + i * 412_337),
        vat="MONOTRIBUTO" if kind == "MONO" else "CONSUMIDOR_FINAL",
        email=f"{first}.{last}{i}@correo-demo.com.ar".lower().replace("á", "a").replace("é", "e").replace("í", "i").replace("ó", "o").replace("ú", "u").replace("ñ", "n"),
        phone=f"351 5{i:02d}-{1000 + i * 37:04d}", consent=i % 3 != 2, type="CUSTOMER",
        # Los últimos 5 clientes dejaron de comprar hace más de 60 días.
        inactive=i >= 25,
    ))
COMPANY_CUSTOMERS = [
    dict(id=uid(), first="Restaurante La Esquina", last="SRL", doc_type=80, doc=cuit("30", 71_234_561), vat="RESPONSABLE_INSCRIPTO",
         email="compras@laesquina-demo.com.ar", phone="351 433-1200", consent=True, type="CUSTOMER", inactive=False),
    dict(id=uid(), first="Hotel Sierras", last="SA", doc_type=80, doc=cuit("30", 70_987_654), vat="RESPONSABLE_INSCRIPTO",
         email="administracion@hotelsierras-demo.com.ar", phone="3543 44-5500", consent=False, type="CUSTOMER", inactive=False),
]
SUPPLIERS = [
    dict(id=uid(), first="Distribuidora Mediterránea", last="SA", doc_type=80, doc=cuit("30", 71_111_222), vat="RESPONSABLE_INSCRIPTO",
         email="ventas@mediterranea-demo.com.ar", phone="351 455-7000", consent=False, type="SUPPLIER", brands=["Del Litoral", "Cocinera Sur", "Campo Verde", "La Nonna", "Ingenio Norte", "Molino Pampa", "Huerta Andina"]),
    dict(id=uid(), first="Lácteos del Centro", last="SRL", doc_type=80, doc=cuit("30", 71_333_444), vat="RESPONSABLE_INSCRIPTO",
         email="pedidos@lacteoscentro-demo.com.ar", phone="351 455-8000", consent=False, type="SUPPLIER", brands=["Tambo Norte"]),
    dict(id=uid(), first="Bebidas Serranas", last="SA", doc_type=80, doc=cuit("30", 71_555_666), vat="RESPONSABLE_INSCRIPTO",
         email="comercial@bebidasserranas-demo.com.ar", phone="351 455-9000", consent=False, type="SUPPLIER", brands=["Burbuja", "Manantial", "Bodega Los Andes", "Cervecería Sierra"]),
    dict(id=uid(), first="Higiene Total", last="SRL", doc_type=80, doc=cuit("30", 71_777_888), vat="RESPONSABLE_INSCRIPTO",
         email="ventas@higienetotal-demo.com.ar", phone="351 456-1000", consent=False, type="SUPPLIER", brands=["Brillo", "Espuma", "Suave", "Natura Sur", "Sonrisa"]),
]
ALL_PEOPLE = CUSTOMERS + COMPANY_CUSTOMERS + SUPPLIERS

DEMO_USERS = [
    # username, nombre, apellido, rol empresa, rol global, sucursal
    ("demo.encargado", "Laura", "Paz", "MANAGER", "MANAGER", 0),
    ("demo.cajero", "Julián", "Sosa", "CASHIER", "CASHIER", 0),
    ("demo.vendedor", "Carla", "Ríos", "SELLER", "SELLER", 1),
    ("demo.deposito", "Ramiro", "Vega", "INVENTORY", "STOCK_CLERK", 4),
    ("demo.contador", "Silvia", "Moreno", "ACCOUNTANT", "USER", None),
]
USER_IDS = {u[0]: uid() for u in DEMO_USERS}
USER_PERSON_IDS = {u[0]: uid() for u in DEMO_USERS}

# ── Encabezado ──────────────────────────────────────────────────
emit("""-- ═══════════════════════════════════════════════════════════════════════════
--  DATOS DE DEMOSTRACIÓN · ERP Comercio (generado por generar_datos_demo.py)
--
--  Crea la empresa ficticia "Almacenes del Centro SRL" con 4 locales + depósito,
--  37 productos, 32 clientes, 4 proveedores, 90 días de ventas, cajas abiertas,
--  pedidos de compra, deuda con proveedores, transferencias y promociones.
--
--  REQUISITOS
--   1. Esquema creado (arrancar la API una vez con NODE_ENV=development).
--   2. Usuario administrador creado con:  npm run seed
--      Si usaste otro ADMIN_BOOTSTRAP_USERNAME, cambialo en @admin_username.
--
--  EJECUCIÓN:  mysql -u <usuario> -p <base> < database/demo/datos-demo.sql
--
--  Se puede ejecutar varias veces: primero borra la empresa demo y la vuelve a crear.
--  Los usuarios demo.* usan la MISMA contraseña que el administrador.
--  NO ejecutar en producción.
-- ═══════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;
-- La conexión usa la MISMA intercalación (collation) que tus tablas: evita el error 1267
-- "Illegal mix of collations" sin importar si la base es utf8mb4_unicode_ci o utf8mb4_0900_ai_ci.
SET @erp_collation = (SELECT COLLATION_NAME FROM information_schema.COLUMNS
                       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'username' LIMIT 1);
SET @erp_set_names = CONCAT('SET NAMES utf8mb4 COLLATE ', COALESCE(@erp_collation, 'utf8mb4_unicode_ci'));
PREPARE erp_stmt FROM @erp_set_names;
EXECUTE erp_stmt;
DEALLOCATE PREPARE erp_stmt;

SET @admin_username = 'admin';
SET @admin_id = (SELECT id FROM users WHERE username = @admin_username LIMIT 1);
SET @admin_hash = (SELECT password_hash FROM users WHERE username = @admin_username LIMIT 1);

-- Si no existe el administrador, el script se detiene acá con un error claro.
DROP TEMPORARY TABLE IF EXISTS _falta_usuario_admin_ejecutar_npm_run_seed;
CREATE TEMPORARY TABLE _falta_usuario_admin_ejecutar_npm_run_seed (admin_id VARCHAR(36) NOT NULL);
INSERT INTO _falta_usuario_admin_ejecutar_npm_run_seed VALUES (@admin_id);
DROP TEMPORARY TABLE _falta_usuario_admin_ejecutar_npm_run_seed;

-- Fechas relativas a HOY en Argentina (UTC-3): los datos siempre quedan recientes.
SET @today = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-03:00'));
SET @base = TIMESTAMP(@today) + INTERVAL 3 HOUR;  -- medianoche de hoy en Argentina, expresada en UTC
""")
emit(f"SET @demo = '{TENANT}';")
emit("""
START TRANSACTION;

-- ── Limpieza de una carga anterior de la demo ───────────────────────────────""")
for table in ["supplier_payment_allocations", "supplier_payments", "supplier_payables", "purchase_receipt_items", "purchase_receipts",
              "purchase_order_items", "purchase_orders", "stock_transfer_items", "stock_transfers", "sale_return_items", "sale_returns",
              "fiscal_documents", "sale_payments", "sale_items", "sales", "cash_movements", "cash_sessions", "cash_registers",
              "inventory_movements", "product_price_history", "product_price_lists", "price_lists", "product_branches", "products",
              "promotions", "fiscal_points_of_sale", "arca_tickets", "fiscal_profiles", "document_sequences", "audit_events"]:
    emit(f"DELETE FROM `{table}` WHERE tenant_id = @demo;")
emit("DELETE ur FROM users_roles ur JOIN users u ON u.id = ur.user_id WHERE u.username LIKE 'demo.%';")
emit("DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'demo.%');")
emit("DELETE FROM tenant_memberships WHERE tenant_id = @demo OR user_id IN (SELECT id FROM (SELECT id FROM users WHERE username LIKE 'demo.%') x);")
emit("DELETE FROM users WHERE username LIKE 'demo.%';")
emit("DELETE FROM persons WHERE tenant_id = @demo;")
emit("DELETE FROM branches WHERE tenant_id = @demo;")
emit("DELETE FROM tenants WHERE id = @demo;")

# ── Empresa, sucursales, perfil fiscal ──────────────────────────
emit("\n-- ── Empresa y sucursales ─────────────────────────────────────────────────────")
insert("tenants", ["id", "slug", "legal_name", "trade_name", "tax_id", "status", "time_zone", "currency_code"],
       [[TENANT, "almacenes-del-centro", "Almacenes del Centro SRL", "Almacenes del Centro", cuit("30", 71_888_999), "ACTIVE",
         "America/Argentina/Buenos_Aires", "ARS"]])
insert("branches", ["id", "tenant_id", "code", "name", "address", "phone", "status"],
       [[b[0], TENANT, b[1], b[2], b[3], b[4], True] for b in BRANCHES])
insert("fiscal_profiles", ["id", "tenant_id", "tax_id", "legal_name", "vat_condition_code", "gross_income_registration", "environment",
                           "certificate_secret_ref", "private_key_secret_ref", "is_active", "activity_start_date", "commercial_address"],
       [[uid(), TENANT, cuit("30", 71_888_999), "Almacenes del Centro SRL", "RESPONSABLE_INSCRIPTO", "904-123456-7", "HOMOLOGATION",
         "file:empresa.crt", "file:empresa.key", True, "2015-03-01", "Av. Colón 1250, Córdoba"]])
insert("fiscal_points_of_sale", ["id", "tenant_id", "branch_id", "number", "environment", "is_active"],
       [[uid(), TENANT, b[0], i + 1, "HOMOLOGATION", True] for i, b in enumerate(STORES)])

# ── Usuarios demo y membresías ──────────────────────────────────
emit("\n-- ── Usuarios: el administrador es TITULAR de la empresa demo; usuarios demo.* por rol ──")
emit("INSERT INTO roles (id, name, description) SELECT UUID(), r.name, r.description FROM ("
     "SELECT 'MANAGER' AS name, 'Encargado' AS description UNION ALL SELECT 'CASHIER', 'Cajero' UNION ALL "
     "SELECT 'SELLER', 'Vendedor' UNION ALL SELECT 'STOCK_CLERK', 'Depósito' UNION ALL SELECT 'USER', 'Consulta' UNION ALL "
     "SELECT 'ADMIN', 'Administración') r WHERE NOT EXISTS (SELECT 1 FROM roles x WHERE x.name = r.name);")
# Membresía del administrador con fecha antigua: la empresa demo queda como predeterminada al ingresar.
emit("INSERT INTO tenant_memberships (id, tenant_id, user_id, branch_id, role, status, accepted_at, created_at, updated_at) "
     f"VALUES ('{uid()}', @demo, @admin_id, NULL, 'OWNER', 'ACTIVE', '2020-01-01 00:00:00', '2020-01-01 00:00:00', '2020-01-01 00:00:00');")
insert("persons", ["id", "tenant_id", "first_name", "last_name", "vat_condition", "person_type", "isActive", "marketing_consent"],
       [[USER_PERSON_IDS[u[0]], TENANT, u[1], u[2], "CONSUMIDOR_FINAL", "BOTH", True, False] for u in DEMO_USERS])
for username, first, last, tenant_role, global_role, branch_index in DEMO_USERS:
    branch_id = BRANCHES[branch_index][0] if branch_index is not None else None
    emit("INSERT INTO users (id, username, password_hash, isActive, person_id, branch_id) "
         f"VALUES ('{USER_IDS[username]}', '{username}', @admin_hash, 1, '{USER_PERSON_IDS[username]}', {q(branch_id)});")
    emit(f"INSERT INTO users_roles (user_id, role_id) SELECT '{USER_IDS[username]}', id FROM roles WHERE name = '{global_role}' LIMIT 1;")
    emit("INSERT INTO tenant_memberships (id, tenant_id, user_id, branch_id, role, status, accepted_at) "
         f"VALUES ('{uid()}', @demo, '{USER_IDS[username]}', {q(branch_id)}, '{tenant_role}', 'ACTIVE', UTC_TIMESTAMP(6));")

# ── Clientes y proveedores ──────────────────────────────────────
emit("\n-- ── Clientes y proveedores ───────────────────────────────────────────────────")
insert("persons", ["id", "tenant_id", "first_name", "last_name", "national_id", "document_type", "vat_condition", "email", "phone",
                   "address", "person_type", "isActive", "marketing_consent", "marketing_consent_at"],
       [[p["id"], TENANT, p["first"], p["last"], p["doc"], p["doc_type"], p["vat"], p["email"], p["phone"],
         "Córdoba, Argentina", p["type"], True, p["consent"], at(-120 * 86400) if p["consent"] else None] for p in ALL_PEOPLE])

# ── Catálogo, precios y stock ───────────────────────────────────
emit("\n-- ── Catálogo ─────────────────────────────────────────────────────────────────")
insert("products", ["id", "tenant_id", "sku", "barcode", "name", "category", "brand", "unit_of_measure", "tax_rate", "vat_treatment",
                    "price_includes_vat", "status"],
       [[p["id"], TENANT, p["sku"], p["ean"], p["name"], p["cat"], p["brand"], p["unit"], p["rate"], p["treat"], True, True] for p in PRODUCTS])

# Precio por sucursal: Río Cuarto 3 % más caro (flete); stock base proporcional a la popularidad.
pb: dict[tuple[str, str], dict] = {}
for p in PRODUCTS:
    for b in BRANCHES:
        factor = D("1.03") if b[1] == "RIO-IV" else D("1")
        price = (p["price"] * factor / 10).quantize(D("1"), rounding=ROUND_HALF_UP) * 10
        minimum = D(max(4, p["pop"] * 3)) if b[5] else D(max(10, p["pop"] * 10))
        pb[(p["id"], b[0])] = dict(id=uid(), price=money(price), cost=p["cost"], min=minimum, sold=D(0))

# ── Ventas (90 días) ────────────────────────────────────────────
POP = [p for p in PRODUCTS if p["pop"] > 0]
WEIGHTS = [p["pop"] for p in POP]
METHODS = [("DEBIT_CARD", 38), ("CASH", 28), ("QR", 18), ("CREDIT_CARD", 12), ("BANK_TRANSFER", 4)]
HOURS = [(9, 4), (10, 7), (11, 10), (12, 11), (13, 8), (14, 4), (15, 3), (16, 4), (17, 7), (18, 10), (19, 11), (20, 8), (21, 3)]
active_customers = [c for c in CUSTOMERS if not c["inactive"]] + COMPANY_CUSTOMERS
inactive_customers = [c for c in CUSTOMERS if c["inactive"]]
SELLERS = [ACTOR, Raw(f"'{USER_IDS['demo.cajero']}'"), Raw(f"'{USER_IDS['demo.vendedor']}'"), Raw(f"'{USER_IDS['demo.encargado']}'")]

sales_rows, item_rows, payment_rows = [], [], []
today_cash: dict[str, list[tuple[str, Decimal, Raw]]] = {b[0]: [] for b in STORES}
daily_sold: dict[tuple[str, str, int], Decimal] = {}
sale_counter = 0

for days_ago in range(89, -1, -1):
    for b in STORES:
        # Más volumen en los últimos 30 días, con días pico y Casa Central como local principal.
        recency = 1.0 if days_ago < 30 else 0.75
        base_tickets = 13 * b[6] * recency
        weekday_factor = 1.45 if days_ago % 7 == 3 else 0.85 if days_ago % 7 == 4 else 1.0
        tickets = max(3, int(rng.gauss(base_tickets * weekday_factor, 2)))
        if days_ago == 0:
            tickets = max(4, tickets // 2)
        for t in range(tickets):
            sale_counter += 1
            hour = rng.choices([h for h, _ in HOURS], [w for _, w in HOURS])[0]
            seconds = hour * 3600 + rng.randint(0, 3599)
            created = at_past(-days_ago * 86400 + seconds, t) if days_ago == 0 else at(-days_ago * 86400 + seconds)
            customer = None
            roll = rng.random()
            if days_ago > 62 and roll < 0.18:
                customer = rng.choice(inactive_customers)
            elif roll < 0.35:
                customer = rng.choice(active_customers)
            sale_id = uid()
            chosen = {}
            for _ in range(rng.choices([1, 2, 3, 4, 5], [30, 30, 20, 12, 8])[0]):
                p = rng.choices(POP, WEIGHTS)[0]
                qty = D(rng.choice(["0.250", "0.500", "0.750", "1.000", "1.500"])) if p["unit"] == "KG" else D(rng.choices([1, 2, 3], [70, 22, 8])[0])
                chosen[p["id"]] = (p, chosen.get(p["id"], (p, D(0)))[1] + qty)
            net_total = tax_total = exempt_total = total = D(0)
            for p, qty in chosen.values():
                row = pb[(p["id"], b[0])]
                amount = money(row["price"] * qty)
                if p["treat"] == "EXEMPT":
                    net, tax, exempt = D(0), D(0), amount
                    arca_id = None
                else:
                    net = money(amount / (1 + p["rate"] / 100))
                    tax, exempt = amount - net, D(0)
                    arca_id = 5 if p["rate"] == 21 else 4
                net_total += net
                tax_total += tax
                exempt_total += exempt
                total += amount
                row["sold"] += qty
                # Kardex: diario el último mes, semanal antes (mantiene el archivo liviano).
                key = (p["id"], b[0], days_ago if days_ago <= 30 else (days_ago // 7) * 7)
                daily_sold[key] = daily_sold.get(key, D(0)) + qty
                item_rows.append([uid(), TENANT, sale_id, p["id"], p["sku"], p["name"], qty, row["price"],
                                  p["rate"] if p["treat"] == "TAXED" else D(0), net, tax, p["treat"], arca_id, True, exempt, D(0), amount,
                                  row["cost"], D(0)])
            company = customer is not None and customer["vat"] in ("RESPONSABLE_INSCRIPTO", "MONOTRIBUTO")
            method = rng.choices([m for m, _ in METHODS], [w for _, w in METHODS])[0]
            if company and method == "CASH":
                method = "BANK_TRANSFER"
            key = f"demo-sale-{sale_counter}"
            sales_rows.append([sale_id, TENANT, b[0], customer["id"] if customer else None, "ARS", net_total + exempt_total, tax_total,
                               net_total, D(0), exempt_total, D(0), "A" if company else "B", "CHARGE", "RESPONSABLE_INSCRIPTO",
                               customer["vat"] if customer else "CONSUMIDOR_FINAL", total, "NOT_ISSUED", "NONE", D(0), key, fp(key),
                               rng.choice(SELLERS), created])
            payment_rows.append([uid(), TENANT, sale_id, method, total, "ARS", None, created])
            if days_ago == 0 and method == "CASH":
                today_cash[b[0]].append((sale_id, total, created))

# Stock final: base según popularidad, algunos casos bajo mínimo y sin stock para las alertas.
for (product_id, branch_id), row in pb.items():
    p = next(x for x in PRODUCTS if x["id"] == product_id)
    branch = next(x for x in BRANCHES if x[0] == branch_id)
    if branch[5]:
        stock = D(max(0, int(rng.gauss(p["pop"] * 9 + 12, 6))))
        if rng.random() < 0.12:
            stock = (row["min"] * D("0.5")).quantize(D("1"))
        if rng.random() < 0.04:
            stock = D(0)
    else:
        stock = D(p["pop"] * 60 + 40)
    if p["unit"] == "KG":
        stock = (stock * D("0.8")).quantize(D("0.001"))
    row["stock"] = stock

# Transferencia en tránsito: el stock ya salió del depósito.
transfer_in_transit = [(PRODUCTS[0], D(48)), (PRODUCTS[12], D(60)), (PRODUCTS[16], D(36))]
for p, qty in transfer_in_transit:
    pb[(p["id"], DEPOT[0])]["stock"] -= qty

emit("\n-- ── Precios y stock por sucursal ─────────────────────────────────────────────")
pb_rows = []
for (product_id, branch_id), row in pb.items():
    margin = min(D("999.99"), money((row["price"] - row["cost"]) / row["cost"] * 100)) if row["cost"] > 0 else D("0")
    pb_rows.append([row["id"], TENANT, product_id, branch_id, row["cost"], margin, row["price"], row["stock"], row["min"], True])
insert("product_branches", ["id", "tenant_id", "product_id", "branch_id", "cost_price", "profit_margin", "selling_price", "stock", "min_stock",
                            "is_active"], pb_rows)

# Kardex coherente: stock inicial hace 91 días + ventas diarias agregadas = stock actual.
emit("\n-- ── Movimientos de stock (kardex) ────────────────────────────────────────────")
mov_rows = []
for (product_id, branch_id), row in pb.items():
    sold_by_day = sorted(((d, q_) for (pid, bid, d), q_ in daily_sold.items() if pid == product_id and bid == branch_id), key=lambda x: -x[0])
    transferred = sum((qty for p, qty in transfer_in_transit if p["id"] == product_id), D(0)) if branch_id == DEPOT[0] else D(0)
    opening = row["stock"] + row["sold"] + transferred
    balance = opening
    mov_rows.append([TENANT, product_id, branch_id, "OPENING", opening, D(0), opening, "Stock inicial (datos de demostración)", None, None,
                     f"demo-open-{row['id']}", ACTOR, at(-91 * 86400 + 8 * 3600)])
    for days_ago, qty in sold_by_day:
        mov_rows.append([TENANT, product_id, branch_id, "SALE", -qty, balance, balance - qty, "Ventas del día (resumen demo)" if days_ago <= 30 else "Ventas de la semana (resumen demo)", "SALE_DAY", None,
                         f"demo-sale-{row['id']}-{days_ago}", ACTOR, at(-days_ago * 86400 + 22 * 3600) if days_ago else Raw("UTC_TIMESTAMP(6)")])
        balance -= qty
    if transferred:
        mov_rows.append([TENANT, product_id, branch_id, "TRANSFER_OUT", -transferred, balance, balance - transferred,
                         "Transferencia #2 a Nueva Córdoba", "STOCK_TRANSFER", None, f"demo-tr-{row['id']}", ACTOR, at(-6 * 3600)])
insert("inventory_movements", ["tenant_id", "product_id", "branch_id", "movement_type", "quantity_delta", "quantity_before", "quantity_after",
                               "reason", "reference_type", "reference_id", "idempotency_key", "actor_user_id", "created_at"], mov_rows, batch=400)

emit("\n-- ── Ventas ───────────────────────────────────────────────────────────────────")
insert("sales", ["id", "tenant_id", "branch_id", "customer_person_id", "currency", "subtotal", "tax_total", "net_taxed_total", "discount_total",
                 "exempt_total", "not_taxed_total", "voucher_class", "vat_charge_mode", "issuer_vat_condition", "customer_vat_condition", "total",
                 "fiscal_status", "return_status", "refunded_total", "idempotency_key", "request_fingerprint", "actor_user_id", "created_at"],
       sales_rows, batch=300)
insert("sale_items", ["id", "tenant_id", "sale_id", "product_id", "sku_snapshot", "name_snapshot", "quantity", "unit_price", "tax_rate",
                      "net_amount", "tax_amount", "vat_treatment", "arca_vat_rate_id", "price_includes_vat", "exempt_amount", "not_taxed_amount",
                      "total", "unit_cost", "discount_amount"], item_rows, batch=400)
insert("sale_payments", ["id", "tenant_id", "sale_id", "method", "amount", "currency", "external_reference", "created_at"], payment_rows, batch=400)

# ── Cajas: una abierta por local con las ventas en efectivo de hoy ──
emit("\n-- ── Cajas (abiertas hoy) ─────────────────────────────────────────────────────")
reg_rows, session_rows, cash_rows = [], [], []
for b in STORES:
    registers = [("CAJA-1", "Caja 1")] + ([("CAJA-2", "Caja 2")] if b[1] == "CENTRAL" else [])
    for index, (code, name) in enumerate(registers):
        reg_id = uid()
        reg_rows.append([reg_id, TENANT, b[0], code, name, True, ACTOR])
        if index > 0:
            continue
        session_id = uid()
        opening = D(50000)
        movements = today_cash[b[0]]
        expense = D(12500) if b[1] == "CENTRAL" else D(0)
        expected = opening + sum((m[1] for m in movements), D(0)) - expense
        okey = f"demo-open-{session_id}"
        session_rows.append([session_id, TENANT, b[0], reg_id, "OPEN", "ARS", opening, expected, okey, fp(okey), ACTOR, at_past(8 * 3600 + 1800, 50)])
        cash_rows.append([uid(), TENANT, b[0], session_id, "OPENING", "IN", opening, "ARS", "Apertura de caja", None, None, None,
                          f"{okey}-m", fp(okey + "m"), ACTOR, at_past(8 * 3600 + 1800, 50)])
        for sale_id, total, created in movements:
            cash_rows.append([uid(), TENANT, b[0], session_id, "SALE", "IN", total, "ARS", "Cobro de venta", "SALE", sale_id, None,
                              f"demo-cash-{sale_id}", fp(sale_id), ACTOR, created])
        if expense:
            cash_rows.append([uid(), TENANT, b[0], session_id, "EXPENSE", "OUT", expense, "ARS", "Pago de flete", None, None, "Remito 0001-00004512",
                              f"demo-exp-{session_id}", fp(session_id + "exp"), ACTOR, at_past(10 * 3600, 1)])
insert("cash_registers", ["id", "tenant_id", "branch_id", "code", "name", "is_active", "created_by_user_id"], reg_rows)
insert("cash_sessions", ["id", "tenant_id", "branch_id", "cash_register_id", "status", "currency", "opening_amount", "expected_amount",
                         "opening_idempotency_key", "opening_request_fingerprint", "opened_by_user_id", "opened_at"], session_rows)
insert("cash_movements", ["id", "tenant_id", "branch_id", "cash_session_id", "type", "direction", "amount", "currency", "reason", "source_type",
                          "source_id", "external_reference", "idempotency_key", "request_fingerprint", "actor_user_id", "created_at"], cash_rows)

# ── Compras: pedidos, recepciones y deuda con proveedores ─────
emit("\n-- ── Compras ──────────────────────────────────────────────────────────────────")
po_rows, poi_rows, rc_rows, rci_rows, pay_rows = [], [], [], [], []


def supplier_products(supplier: dict, limit: int) -> list[dict]:
    items = [p for p in PRODUCTS if p["brand"] in supplier["brands"] and p["pop"] > 0]
    return items[:limit]


orders = [
    # número, proveedor, sucursal, estado, días atrás, recibido (fracción)
    (1, SUPPLIERS[0], DEPOT, "RECEIVED", 20, 1.0),
    (2, SUPPLIERS[1], BRANCHES[0], "RECEIVED", 12, 1.0),
    (3, SUPPLIERS[2], DEPOT, "PARTIALLY_RECEIVED", 5, 0.5),
    (4, SUPPLIERS[3], BRANCHES[1], "SENT", 2, 0.0),
    (5, SUPPLIERS[0], BRANCHES[3], "DRAFT", 1, 0.0),
]
for number, supplier, branch, status, days_ago, fraction in orders:
    order_id = uid()
    estimated = D(0)
    received_lines = []
    for p in supplier_products(supplier, 6):
        ordered = D(rng.choice([24, 36, 48, 60]))
        received = (ordered * D(str(fraction))).quantize(D("1"))
        estimated += money(ordered * p["cost"] * (1 + p["rate"] / 100))
        poi_rows.append([uid(), TENANT, order_id, p["id"], p["sku"], p["name"], ordered, received, p["cost"], p["rate"]])
        if received > 0:
            received_lines.append((p, received))
    po_rows.append([order_id, TENANT, number, supplier["id"], branch[0], status, day_date(-days_ago + 4), None, "ARS", estimated, ACTOR,
                    at(-days_ago * 86400 + 10 * 3600) if status != "DRAFT" else None,
                    at(-days_ago * 86400 + 30 * 3600) if status == "RECEIVED" else None, None, at(-days_ago * 86400 + 9 * 3600)])
    if received_lines:
        receipt_id = uid()
        net = tax = D(0)
        for p, received in received_lines:
            line_net = money(received * p["cost"])
            line_tax = money(line_net * p["rate"] / 100)
            net += line_net
            tax += line_tax
            rci_rows.append([uid(), TENANT, receipt_id, p["id"], p["sku"], p["name"], received, p["cost"], p["rate"], line_net, line_tax, line_net + line_tax])
        rkey = f"demo-receipt-{number}"
        rc_rows.append([receipt_id, TENANT, branch[0], supplier["id"], order_id, "ARS", "Factura A", f"0004-000{18230 + number}", net, tax, net + tax,
                        rkey, fp(rkey), ACTOR, at(-(days_ago - 1) * 86400 + 11 * 3600)])
        # Primera compra pagada a medias y vencida; el resto, a vencer.
        due = -3 if number == 1 else 15 + number
        paid = money((net + tax) * D("0.4")) if number == 1 else D(0)
        pay_rows.append([uid(), TENANT, branch[0], supplier["id"], receipt_id, "ARS", net + tax, paid, day_date(due), at(-(days_ago - 1) * 86400 + 11 * 3600)])
insert("purchase_orders", ["id", "tenant_id", "number", "supplier_person_id", "branch_id", "status", "expected_date", "notes", "currency",
                           "estimated_total", "created_by_user_id", "sent_at", "closed_at", "cancel_reason", "created_at"], po_rows)
insert("purchase_order_items", ["id", "tenant_id", "purchase_order_id", "product_id", "sku_snapshot", "name_snapshot", "quantity_ordered",
                                "quantity_received", "unit_cost", "tax_rate"], poi_rows)
insert("purchase_receipts", ["id", "tenant_id", "branch_id", "supplier_person_id", "purchase_order_id", "currency", "source_document_type",
                             "source_document_number", "subtotal", "tax_total", "total", "idempotency_key", "request_fingerprint", "actor_user_id",
                             "created_at"], rc_rows)
insert("purchase_receipt_items", ["id", "tenant_id", "purchase_receipt_id", "product_id", "sku_snapshot", "name_snapshot", "quantity", "unit_cost",
                                  "tax_rate", "net_amount", "tax_amount", "total"], rci_rows)
insert("supplier_payables", ["id", "tenant_id", "branch_id", "supplier_person_id", "purchase_receipt_id", "currency", "original_amount",
                             "amount_paid", "due_date", "created_at"], pay_rows)

# ── Transferencias ─────────────────────────────────────────────
emit("\n-- ── Transferencias entre sucursales ──────────────────────────────────────────")
tr_rows, tri_rows = [], []
received_id, transit_id = uid(), uid()
tr_rows.append([received_id, TENANT, 1, DEPOT[0], BRANCHES[0][0], "RECEIVED", "Reposición semanal", ACTOR, Raw(f"'{USER_IDS['demo.encargado']}'"),
                at(-3 * 86400 + 16 * 3600), "Llegó completo", "demo-transfer-1", fp("demo-transfer-1"), at(-3 * 86400 + 9 * 3600)])
for p in PRODUCTS[:4]:
    tri_rows.append([uid(), TENANT, received_id, p["id"], p["sku"], p["name"], D(24), D(24), p["cost"]])
tr_rows.append([transit_id, TENANT, 2, DEPOT[0], BRANCHES[1][0], "SENT", "Pedido urgente de Nueva Córdoba", ACTOR, None, None, None,
                "demo-transfer-2", fp("demo-transfer-2"), at(-6 * 3600)])
for p, qty in transfer_in_transit:
    tri_rows.append([uid(), TENANT, transit_id, p["id"], p["sku"], p["name"], qty, None, p["cost"]])
insert("stock_transfers", ["id", "tenant_id", "number", "origin_branch_id", "destination_branch_id", "status", "notes", "sent_by_user_id",
                           "received_by_user_id", "received_at", "receipt_notes", "idempotency_key", "request_fingerprint", "created_at"], tr_rows)
insert("stock_transfer_items", ["id", "tenant_id", "transfer_id", "product_id", "sku_snapshot", "name_snapshot", "quantity_sent", "quantity_received",
                                "unit_cost"], tri_rows)

# Numeradores: los próximos pedidos / transferencias continúan la numeración.
insert("document_sequences", ["tenant_id", "name", "value"], [[TENANT, "PURCHASE_ORDER", 5], [TENANT, "STOCK_TRANSFER", 2], [TENANT, "SALE_RETURN", 0]])

# ── Promociones ────────────────────────────────────────────────
emit("\n-- ── Promociones ──────────────────────────────────────────────────────────────")
insert("promotions", ["id", "tenant_id", "name", "description", "type", "percent_basis_points", "buy_quantity", "pay_quantity", "product_ids",
                      "categories", "brands", "branch_ids", "weekdays", "min_quantity", "starts_at", "ends_at", "is_active", "created_by_user_id"], [
    [uid(), TENANT, "3x2 en yerbas Del Litoral", "Llevando 3, se paga la más barata gratis", "BUY_X_PAY_Y", None, 3, 2, None, json.dumps(["Almacén"]),
     json.dumps(["Del Litoral"]), None, None, None, day_date(-10), day_date(20), True, ACTOR],
    [uid(), TENANT, "Miércoles 15 % en lácteos", None, "PERCENTAGE", 1500, None, None, None, json.dumps(["Lácteos"]), None, None, json.dumps([3]),
     None, None, None, True, ACTOR],
    [uid(), TENANT, "Liquidación limpieza Río Cuarto", "Rotar stock de limpieza", "PERCENTAGE", 2000, None, None, None, json.dumps(["Limpieza"]), None,
     json.dumps([BRANCHES[3][0]]), None, None, day_date(5), day_date(35), True, ACTOR],
])

emit("""
COMMIT;

-- Resumen de lo cargado
SELECT 'Empresa' AS dato, legal_name AS valor FROM tenants WHERE id = @demo
UNION ALL SELECT 'Sucursales', COUNT(*) FROM branches WHERE tenant_id = @demo
UNION ALL SELECT 'Productos', COUNT(*) FROM products WHERE tenant_id = @demo
UNION ALL SELECT 'Clientes y proveedores', COUNT(*) FROM persons WHERE tenant_id = @demo
UNION ALL SELECT 'Ventas', COUNT(*) FROM sales WHERE tenant_id = @demo
UNION ALL SELECT 'Facturación total', CONCAT('$ ', FORMAT(SUM(total), 2, 'es_AR')) FROM sales WHERE tenant_id = @demo
UNION ALL SELECT 'Usuarios demo', GROUP_CONCAT(username) FROM users WHERE username LIKE 'demo.%';
""")

OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"{OUT} · {len(sales_rows)} ventas · {len(item_rows)} renglones · {OUT.stat().st_size / 1024:.0f} KB")
