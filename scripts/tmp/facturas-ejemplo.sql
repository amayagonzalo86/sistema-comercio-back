-- ═══════════════════════════════════════════════════════════════════════════
--  FACTURAS DE EJEMPLO (Homologación, sin validez fiscal) para la empresa demo
--  Genera facturas autorizadas para las últimas 40 ventas sin facturar, con su
--  número, CAE de prueba y fecha, y marca esas ventas como facturadas.
--  Se puede ejecutar más de una vez: solo factura ventas que todavía no tienen factura.
-- ═══════════════════════════════════════════════════════════════════════════
USE `sistema_comercio`;
SET time_zone = '+00:00';
SET SQL_SAFE_UPDATES = 0;

INSERT INTO `fiscal_documents`
  (`id`, `tenant_id`, `branch_id`, `source_type`, `source_id`, `environment`, `voucher_class`, `voucher_type`,
   `point_of_sale`, `number`, `status`, `cae`, `cae_expiration`, `issue_date`, `doc_type`, `doc_number`,
   `receiver_condition_id`, `total`, `net_taxed`, `vat_total`, `exempt`, `not_taxed`, `vat_rates`,
   `attempts`, `actor_user_id`, `authorized_at`, `created_at`, `updated_at`)
SELECT
  UUID(), n.tenant_id, n.branch_id, 'SALE', n.sale_id, 'HOMOLOGATION', n.voucher_class, n.voucher_type,
  n.pos, n.last_number + n.rn, 'AUTHORIZED',
  CONCAT('7', LPAD(n.pos, 4, '0'), LPAD(n.last_number + n.rn, 9, '0')),
  DATE_ADD(n.issue_date, INTERVAL 10 DAY), n.issue_date, n.doc_type, n.doc_number,
  n.receiver_condition_id, n.total, n.net_taxed, n.vat_total, n.exempt, 0,
  IF(n.vat_total > 0, JSON_ARRAY(JSON_OBJECT('arcaId', 5, 'base', CAST(n.net_taxed AS CHAR), 'amount', CAST(n.vat_total AS CHAR))), JSON_ARRAY()),
  1, n.actor_user_id, n.created_at, n.created_at, n.created_at
FROM (
  SELECT
    c.*,
    ROW_NUMBER() OVER (PARTITION BY c.pos, c.voucher_type ORDER BY c.created_at, c.sale_id) AS rn,
    COALESCE((SELECT MAX(d.number) FROM `fiscal_documents` d
               WHERE d.tenant_id = c.tenant_id AND d.environment = 'HOMOLOGATION'
                 AND d.point_of_sale = c.pos AND d.voucher_type = c.voucher_type), 0) AS last_number
  FROM (
    SELECT
      s.id AS sale_id, s.tenant_id, s.branch_id, s.voucher_class,
      CASE s.voucher_class WHEN 'A' THEN 1 WHEN 'C' THEN 11 ELSE 6 END AS voucher_type,
      pv.number AS pos,
      DATE(CONVERT_TZ(s.created_at, '+00:00', '-03:00')) AS issue_date,
      COALESCE(p.document_type, 99) AS doc_type,
      COALESCE(p.national_id, '0') AS doc_number,
      CASE s.customer_vat_condition
        WHEN 'RESPONSABLE_INSCRIPTO' THEN 1 WHEN 'MONOTRIBUTO' THEN 6 WHEN 'EXENTO' THEN 4 ELSE 5 END AS receiver_condition_id,
      s.total, s.net_taxed_total AS net_taxed, s.tax_total AS vat_total, s.exempt_total AS exempt,
      s.actor_user_id, s.created_at
    FROM `sales` s
    JOIN `fiscal_points_of_sale` pv
      ON pv.tenant_id = s.tenant_id AND pv.branch_id = s.branch_id AND pv.environment = 'HOMOLOGATION' AND pv.is_active = 1
    LEFT JOIN `persons` p ON p.id = s.customer_person_id AND p.tenant_id = s.tenant_id
    WHERE s.tenant_id = '9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f'
      AND s.voucher_class IN ('A', 'B', 'C')
      AND NOT EXISTS (SELECT 1 FROM `fiscal_documents` f
                       WHERE f.tenant_id = s.tenant_id AND f.source_type = 'SALE' AND f.source_id = s.id)
    ORDER BY s.created_at DESC
    LIMIT 40
  ) c
) n;

-- Las ventas facturadas quedan como "Autorizada" en Ventas.
UPDATE `sales` s
JOIN `fiscal_documents` f ON f.tenant_id = s.tenant_id AND f.source_type = 'SALE' AND f.source_id = s.id
SET s.fiscal_status = 'AUTHORIZED'
WHERE s.tenant_id = '9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f' AND f.status = 'AUTHORIZED' AND s.fiscal_status <> 'AUTHORIZED';

-- Resultado
SELECT voucher_class AS letra, COUNT(*) AS facturas, MIN(number) AS desde, MAX(number) AS hasta, SUM(total) AS total
FROM `fiscal_documents`
WHERE tenant_id = '9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f'
GROUP BY voucher_class;
