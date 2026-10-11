
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
DROP TABLE IF EXISTS `arca_tickets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arca_tickets` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `service` varchar(20) NOT NULL,
  `environment` enum('HOMOLOGATION','PRODUCTION') NOT NULL,
  `sealed_token` text NOT NULL,
  `sealed_sign` text NOT NULL,
  `expires_at` timestamp(6) NOT NULL,
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_arca_tickets_tenant_service_env` (`tenant_id`,`service`,`environment`),
  CONSTRAINT `FK_arca_tickets_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `audit_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(36) NOT NULL,
  `actor_user_id` varchar(36) DEFAULT NULL,
  `event_type` varchar(80) NOT NULL,
  `aggregate_type` varchar(80) NOT NULL,
  `aggregate_id` varchar(100) NOT NULL,
  `request_id` varchar(100) DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` varchar(512) DEFAULT NULL,
  `metadata` json DEFAULT NULL,
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `IDX_audit_request` (`request_id`),
  KEY `IDX_audit_tenant_aggregate` (`tenant_id`,`aggregate_type`,`aggregate_id`,`created_at`),
  KEY `IDX_audit_tenant_id` (`tenant_id`,`id`),
  KEY `IDX_audit_tenant_time` (`tenant_id`,`created_at`),
  CONSTRAINT `FK_d7ff59f708e396fd6c1656a66e9` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `auth_rate_limits`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `auth_rate_limits` (
  `scope_hash` char(64) NOT NULL,
  `attempt_count` int unsigned NOT NULL DEFAULT '0',
  `window_started_at` timestamp(6) NOT NULL,
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`scope_hash`),
  KEY `IDX_auth_rate_limit_window` (`window_started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `branches`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `branches` (
  `id` varchar(36) NOT NULL,
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `deleted_at` timestamp(6) NULL DEFAULT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `code` varchar(20) NOT NULL,
  `name` varchar(150) NOT NULL,
  `address` varchar(255) DEFAULT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `status` tinyint NOT NULL DEFAULT '1',
  `allowed_ip_ranges` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_branches_tenant_id` (`tenant_id`,`id`),
  UNIQUE KEY `UQ_branches_tenant_code` (`tenant_id`,`code`),
  KEY `IDX_branches_tenant_status` (`tenant_id`,`status`),
  CONSTRAINT `FK_fda619979f40a6a44fc9baf02c3` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `cash_movements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cash_movements` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `branch_id` varchar(36) NOT NULL,
  `cash_session_id` varchar(36) NOT NULL,
  `type` enum('OPENING','SALE','REFUND','INCOME','EXPENSE','ADJUSTMENT') NOT NULL,
  `direction` enum('IN','OUT') NOT NULL,
  `amount` decimal(14,2) NOT NULL,
  `currency` char(3) NOT NULL,
  `reason` varchar(240) NOT NULL,
  `source_type` varchar(40) DEFAULT NULL,
  `source_id` varchar(36) DEFAULT NULL,
  `external_reference` varchar(100) DEFAULT NULL,
  `idempotency_key` varchar(100) NOT NULL,
  `request_fingerprint` char(64) NOT NULL,
  `actor_user_id` varchar(36) NOT NULL,
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_cash_movements_tenant_session_idempotency` (`tenant_id`,`cash_session_id`,`idempotency_key`),
  UNIQUE KEY `UQ_cash_movements_tenant_id` (`tenant_id`,`id`),
  KEY `IDX_cash_movements_tenant_branch_created` (`tenant_id`,`branch_id`,`created_at`,`id`),
  KEY `IDX_cash_movements_tenant_session_created` (`tenant_id`,`cash_session_id`,`created_at`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `cash_registers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cash_registers` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `branch_id` varchar(36) NOT NULL,
  `code` varchar(32) NOT NULL,
  `name` varchar(120) NOT NULL,
  `is_active` tinyint NOT NULL DEFAULT '1',
  `created_by_user_id` varchar(36) NOT NULL,
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_cash_register_tenant_branch_id` (`tenant_id`,`branch_id`,`id`),
  UNIQUE KEY `UQ_cash_register_tenant_branch_code` (`tenant_id`,`branch_id`,`code`),
  UNIQUE KEY `UQ_cash_register_tenant_id` (`tenant_id`,`id`),
  KEY `IDX_cash_register_tenant_branch_active` (`tenant_id`,`branch_id`,`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `cash_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cash_sessions` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `branch_id` varchar(36) NOT NULL,
  `cash_register_id` varchar(36) NOT NULL,
  `open_register_id` varchar(36) GENERATED ALWAYS AS ((case when (`status` = _utf8mb4'OPEN') then `cash_register_id` else NULL end)) STORED,
  `status` enum('OPEN','CLOSED') NOT NULL DEFAULT 'OPEN',
  `currency` char(3) NOT NULL,
  `opening_amount` decimal(14,2) NOT NULL,
  `expected_amount` decimal(14,2) NOT NULL,
  `counted_amount` decimal(14,2) DEFAULT NULL,
  `difference_amount` decimal(14,2) DEFAULT NULL,
  `opening_idempotency_key` varchar(100) NOT NULL,
  `opening_request_fingerprint` char(64) NOT NULL,
  `opened_by_user_id` varchar(36) NOT NULL,
  `close_idempotency_key` varchar(100) DEFAULT NULL,
  `close_request_fingerprint` char(64) DEFAULT NULL,
  `closed_by_user_id` varchar(36) DEFAULT NULL,
  `opened_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `closed_at` timestamp(6) NULL DEFAULT NULL,
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_cash_sessions_tenant_opening_key` (`tenant_id`,`opening_idempotency_key`),
  UNIQUE KEY `UQ_cash_sessions_tenant_branch_id` (`tenant_id`,`branch_id`,`id`),
  UNIQUE KEY `UQ_cash_sessions_tenant_id` (`tenant_id`,`id`),
  UNIQUE KEY `UQ_cash_sessions_one_open_per_register` (`tenant_id`,`open_register_id`),
  UNIQUE KEY `UQ_cash_sessions_tenant_close_key` (`tenant_id`,`close_idempotency_key`),
  KEY `IDX_cash_sessions_tenant_register_opened` (`tenant_id`,`cash_register_id`,`opened_at`),
  KEY `IDX_cash_sessions_tenant_branch_status` (`tenant_id`,`branch_id`,`status`,`opened_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `document_sequences`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `document_sequences` (
  `tenant_id` varchar(36) NOT NULL,
  `name` varchar(40) NOT NULL,
  `value` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`tenant_id`,`name`),
  CONSTRAINT `FK_document_sequences_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `fiscal_documents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fiscal_documents` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `branch_id` varchar(36) NOT NULL,
  `source_type` enum('SALE','SALE_RETURN') NOT NULL,
  `source_id` varchar(36) NOT NULL,
  `environment` enum('HOMOLOGATION','PRODUCTION') NOT NULL,
  `voucher_class` char(1) NOT NULL,
  `voucher_type` smallint unsigned NOT NULL,
  `point_of_sale` int unsigned NOT NULL,
  `number` int unsigned DEFAULT NULL,
  `status` enum('PENDING','AUTHORIZED','REJECTED','ERROR') NOT NULL DEFAULT 'PENDING',
  `cae` varchar(14) DEFAULT NULL,
  `cae_expiration` date DEFAULT NULL,
  `issue_date` date NOT NULL,
  `doc_type` smallint unsigned NOT NULL,
  `doc_number` varchar(20) NOT NULL,
  `receiver_condition_id` smallint unsigned NOT NULL,
  `total` decimal(14,2) NOT NULL,
  `net_taxed` decimal(14,2) NOT NULL,
  `vat_total` decimal(14,2) NOT NULL,
  `exempt` decimal(14,2) NOT NULL,
  `not_taxed` decimal(14,2) NOT NULL,
  `vat_rates` json NOT NULL,
  `associated_document_id` varchar(36) DEFAULT NULL,
  `observations` json DEFAULT NULL,
  `error_message` varchar(1000) DEFAULT NULL,
  `attempts` smallint unsigned NOT NULL DEFAULT '0',
  `actor_user_id` varchar(36) NOT NULL,
  `authorized_at` timestamp(6) NULL DEFAULT NULL,
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_fiscal_documents_source` (`tenant_id`,`source_type`,`source_id`),
  UNIQUE KEY `UQ_fiscal_documents_number` (`tenant_id`,`environment`,`point_of_sale`,`voucher_type`,`number`),
  KEY `IDX_fiscal_documents_tenant_issued` (`tenant_id`,`issue_date`),
  CONSTRAINT `FK_fiscal_documents_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `fiscal_points_of_sale`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fiscal_points_of_sale` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `branch_id` varchar(36) NOT NULL,
  `number` int unsigned NOT NULL,
  `environment` enum('HOMOLOGATION','PRODUCTION') NOT NULL,
  `is_active` tinyint NOT NULL DEFAULT '1',
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_fiscal_pos_tenant_env_branch` (`tenant_id`,`environment`,`branch_id`),
  UNIQUE KEY `UQ_fiscal_pos_tenant_env_number` (`tenant_id`,`environment`,`number`),
  KEY `FK_fiscal_pos_branch` (`branch_id`),
  CONSTRAINT `FK_fiscal_pos_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `FK_fiscal_pos_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `fiscal_profiles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fiscal_profiles` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `tax_id` varchar(11) NOT NULL,
  `legal_name` varchar(200) NOT NULL,
  `vat_condition_code` varchar(40) NOT NULL,
  `gross_income_registration` varchar(32) DEFAULT NULL,
  `environment` enum('HOMOLOGATION','PRODUCTION') NOT NULL DEFAULT 'HOMOLOGATION',
  `certificate_secret_ref` varchar(255) DEFAULT NULL,
  `private_key_secret_ref` varchar(255) DEFAULT NULL,
  `is_active` tinyint NOT NULL DEFAULT '0',
  `activity_start_date` date DEFAULT NULL,
  `commercial_address` varchar(255) DEFAULT NULL,
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_fiscal_profile_tenant_tax_env` (`tenant_id`,`tax_id`,`environment`),
  KEY `IDX_fiscal_profile_tenant_status` (`tenant_id`,`is_active`),
  CONSTRAINT `FK_6fda42243d7fe2eff1e352986d7` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `inventory_movements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inventory_movements` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(36) NOT NULL,
  `product_id` varchar(36) NOT NULL,
  `branch_id` varchar(36) NOT NULL,
  `movement_type` enum('OPENING','ADJUSTMENT','PURCHASE','SALE','RETURN','TRANSFER_IN','TRANSFER_OUT') NOT NULL,
  `quantity_delta` decimal(12,3) NOT NULL,
  `quantity_before` decimal(12,3) NOT NULL,
  `quantity_after` decimal(12,3) NOT NULL,
  `reason` varchar(255) NOT NULL,
  `reference_type` varchar(50) DEFAULT NULL,
  `reference_id` varchar(36) DEFAULT NULL,
  `idempotency_key` varchar(100) NOT NULL,
  `actor_user_id` varchar(36) DEFAULT NULL,
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_inventory_movements_tenant_idempotency` (`tenant_id`,`idempotency_key`),
  KEY `IDX_inventory_movements_tenant_time` (`tenant_id`,`created_at`),
  KEY `IDX_inventory_movements_stock_cursor` (`tenant_id`,`product_id`,`branch_id`,`id`)
) ENGINE=InnoDB AUTO_INCREMENT=6995 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `persons`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `persons` (
  `id` varchar(36) NOT NULL,
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `deleted_at` timestamp(6) NULL DEFAULT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `first_name` varchar(100) NOT NULL,
  `last_name` varchar(100) NOT NULL,
  `national_id` varchar(20) DEFAULT NULL,
  `document_type` smallint unsigned DEFAULT NULL,
  `vat_condition` varchar(40) NOT NULL DEFAULT 'CONSUMIDOR_FINAL',
  `email` varchar(150) DEFAULT NULL,
  `phone` varchar(30) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `person_type` enum('CUSTOMER','SUPPLIER','BOTH') NOT NULL DEFAULT 'BOTH',
  `isActive` tinyint NOT NULL DEFAULT '1',
  `marketing_consent` tinyint NOT NULL DEFAULT '0',
  `marketing_consent_at` timestamp(6) NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_persons_tenant_id` (`tenant_id`,`id`),
  UNIQUE KEY `UQ_persons_tenant_email` (`tenant_id`,`email`),
  UNIQUE KEY `UQ_persons_tenant_national_id` (`tenant_id`,`national_id`),
  CONSTRAINT `FK_3531703a6fd66767c18c09e92e2` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `price_lists`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `price_lists` (
  `tenant_id` varchar(36) NOT NULL,
  `id` varchar(36) NOT NULL,
  `name` varchar(150) NOT NULL,
  `description` text,
  `percentage` decimal(5,2) NOT NULL DEFAULT '0.00',
  `is_default` tinyint NOT NULL DEFAULT '0',
  `is_active` tinyint NOT NULL DEFAULT '1',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_price_lists_tenant_id` (`tenant_id`,`id`),
  KEY `IDX_price_lists_tenant_active` (`tenant_id`,`is_active`),
  CONSTRAINT `FK_35de7c0f11722fb48e2b09a466f` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `product_branches`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `product_branches` (
  `tenant_id` varchar(36) NOT NULL,
  `id` varchar(36) NOT NULL,
  `product_id` varchar(36) NOT NULL,
  `branch_id` varchar(36) NOT NULL,
  `cost_price` decimal(12,2) NOT NULL DEFAULT '0.00',
  `profit_margin` decimal(5,2) NOT NULL DEFAULT '30.00',
  `selling_price` decimal(12,2) NOT NULL DEFAULT '0.00',
  `stock` decimal(12,3) NOT NULL DEFAULT '0.000',
  `min_stock` decimal(12,3) NOT NULL DEFAULT '0.000',
  `is_active` tinyint NOT NULL DEFAULT '1',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_product_branches_tenant_product_branch` (`tenant_id`,`product_id`,`branch_id`),
  KEY `IDX_product_branches_tenant_branch` (`tenant_id`,`branch_id`),
  KEY `FK_f68165c7b4c062099b0d317432b` (`product_id`),
  KEY `FK_c5fe02b5d504aca769bbfdc2d33` (`branch_id`),
  CONSTRAINT `FK_c5fe02b5d504aca769bbfdc2d33` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE CASCADE,
  CONSTRAINT `FK_f68165c7b4c062099b0d317432b` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `product_price_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `product_price_history` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(36) NOT NULL,
  `product_id` varchar(36) NOT NULL,
  `branch_id` varchar(36) NOT NULL,
  `old_cost_price` decimal(12,2) NOT NULL,
  `new_cost_price` decimal(12,2) NOT NULL,
  `old_selling_price` decimal(12,2) NOT NULL,
  `new_selling_price` decimal(12,2) NOT NULL,
  `reason` varchar(200) NOT NULL,
  `batch_id` varchar(36) DEFAULT NULL,
  `actor_user_id` varchar(36) NOT NULL,
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `IDX_price_history_batch` (`tenant_id`,`batch_id`),
  KEY `IDX_price_history_product` (`tenant_id`,`product_id`,`created_at`),
  CONSTRAINT `FK_price_history_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `product_price_lists`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `product_price_lists` (
  `tenant_id` varchar(36) NOT NULL,
  `id` varchar(36) NOT NULL,
  `price_list_id` varchar(36) NOT NULL,
  `product_id` varchar(36) NOT NULL,
  `applied_percentage` decimal(7,2) NOT NULL COMMENT 'Porcentaje real registrado y recalculado por la regla de negocio',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_product_price_lists_tenant_list_product` (`tenant_id`,`price_list_id`,`product_id`),
  KEY `FK_467b0a6f0407dc38b167c435555` (`price_list_id`),
  KEY `FK_58cc7ae48f32dbf75608ad130b9` (`product_id`),
  CONSTRAINT `FK_467b0a6f0407dc38b167c435555` FOREIGN KEY (`price_list_id`) REFERENCES `price_lists` (`id`) ON DELETE CASCADE,
  CONSTRAINT `FK_58cc7ae48f32dbf75608ad130b9` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `products`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `products` (
  `tenant_id` varchar(36) NOT NULL,
  `id` varchar(36) NOT NULL,
  `sku` varchar(50) NOT NULL,
  `barcode` varchar(100) DEFAULT NULL,
  `name` varchar(150) NOT NULL,
  `description` text,
  `category` varchar(80) DEFAULT NULL,
  `brand` varchar(80) DEFAULT NULL,
  `unit_of_measure` enum('UNIT','KG','LITER','METER','PACK') NOT NULL DEFAULT 'UNIT',
  `tax_rate` decimal(5,2) NOT NULL DEFAULT '21.00',
  `vat_treatment` enum('TAXED','EXEMPT','NOT_TAXED') NOT NULL DEFAULT 'TAXED',
  `price_includes_vat` tinyint NOT NULL DEFAULT '0',
  `status` tinyint NOT NULL DEFAULT '1',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `deleted_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_products_tenant_id` (`tenant_id`,`id`),
  UNIQUE KEY `UQ_products_tenant_sku` (`tenant_id`,`sku`),
  KEY `IDX_adfc522baf9d9b19cd7d9461b7` (`barcode`),
  KEY `IDX_products_tenant_brand` (`tenant_id`,`brand`),
  KEY `IDX_products_tenant_category` (`tenant_id`,`category`),
  KEY `IDX_products_tenant_barcode` (`tenant_id`,`barcode`),
  CONSTRAINT `FK_9c365ebf78f0e8a6d9e4827ea70` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `promotions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `promotions` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `name` varchar(120) NOT NULL,
  `description` varchar(500) DEFAULT NULL,
  `type` enum('PERCENTAGE','BUY_X_PAY_Y') NOT NULL,
  `percent_basis_points` int unsigned DEFAULT NULL,
  `buy_quantity` int unsigned DEFAULT NULL,
  `pay_quantity` int unsigned DEFAULT NULL,
  `product_ids` json DEFAULT NULL,
  `categories` json DEFAULT NULL,
  `brands` json DEFAULT NULL,
  `branch_ids` json DEFAULT NULL,
  `weekdays` json DEFAULT NULL,
  `min_quantity` decimal(12,3) DEFAULT NULL,
  `starts_at` date DEFAULT NULL,
  `ends_at` date DEFAULT NULL,
  `is_active` tinyint NOT NULL DEFAULT '1',
  `created_by_user_id` varchar(36) NOT NULL,
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `IDX_promotions_tenant_active` (`tenant_id`,`is_active`,`starts_at`,`ends_at`),
  CONSTRAINT `FK_promotions_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `purchase_order_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `purchase_order_items` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `purchase_order_id` varchar(36) NOT NULL,
  `product_id` varchar(36) NOT NULL,
  `sku_snapshot` varchar(50) NOT NULL,
  `name_snapshot` varchar(150) NOT NULL,
  `quantity_ordered` decimal(12,3) NOT NULL,
  `quantity_received` decimal(12,3) NOT NULL DEFAULT '0.000',
  `unit_cost` decimal(12,2) NOT NULL,
  `tax_rate` decimal(5,2) NOT NULL DEFAULT '21.00',
  PRIMARY KEY (`id`),
  KEY `IDX_purchase_order_items_product` (`tenant_id`,`product_id`),
  KEY `IDX_purchase_order_items_order` (`tenant_id`,`purchase_order_id`),
  KEY `FK_purchase_order_items_order` (`purchase_order_id`),
  KEY `FK_purchase_order_items_product` (`product_id`),
  CONSTRAINT `FK_purchase_order_items_order` FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `FK_purchase_order_items_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `purchase_orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `purchase_orders` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `number` int unsigned NOT NULL,
  `supplier_person_id` varchar(36) NOT NULL,
  `branch_id` varchar(36) NOT NULL,
  `status` enum('DRAFT','SENT','PARTIALLY_RECEIVED','RECEIVED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `expected_date` date DEFAULT NULL,
  `notes` varchar(500) DEFAULT NULL,
  `currency` char(3) NOT NULL,
  `estimated_total` decimal(14,2) NOT NULL DEFAULT '0.00',
  `created_by_user_id` varchar(36) NOT NULL,
  `sent_at` timestamp(6) NULL DEFAULT NULL,
  `closed_at` timestamp(6) NULL DEFAULT NULL,
  `cancel_reason` varchar(200) DEFAULT NULL,
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_purchase_orders_tenant_number` (`tenant_id`,`number`),
  KEY `IDX_purchase_orders_branch` (`tenant_id`,`branch_id`,`created_at`),
  KEY `IDX_purchase_orders_supplier` (`tenant_id`,`supplier_person_id`,`created_at`),
  KEY `IDX_purchase_orders_tenant_status` (`tenant_id`,`status`,`created_at`),
  KEY `FK_purchase_orders_supplier` (`supplier_person_id`),
  KEY `FK_purchase_orders_branch` (`branch_id`),
  CONSTRAINT `FK_purchase_orders_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `FK_purchase_orders_supplier` FOREIGN KEY (`supplier_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `FK_purchase_orders_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `purchase_receipt_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `purchase_receipt_items` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `purchase_receipt_id` varchar(36) NOT NULL,
  `product_id` varchar(36) NOT NULL,
  `sku_snapshot` varchar(50) NOT NULL,
  `name_snapshot` varchar(150) NOT NULL,
  `quantity` decimal(12,3) NOT NULL,
  `unit_cost` decimal(12,2) NOT NULL,
  `tax_rate` decimal(5,2) NOT NULL,
  `net_amount` decimal(14,2) NOT NULL,
  `tax_amount` decimal(14,2) NOT NULL,
  `total` decimal(14,2) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_purchase_receipt_items_tenant_receipt_product` (`tenant_id`,`purchase_receipt_id`,`product_id`),
  KEY `IDX_purchase_receipt_items_tenant_product` (`tenant_id`,`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `purchase_receipts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `purchase_receipts` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `branch_id` varchar(36) NOT NULL,
  `supplier_person_id` varchar(36) NOT NULL,
  `purchase_order_id` varchar(36) DEFAULT NULL,
  `currency` char(3) NOT NULL,
  `source_document_type` varchar(30) DEFAULT NULL,
  `source_document_number` varchar(80) DEFAULT NULL,
  `subtotal` decimal(14,2) NOT NULL,
  `tax_total` decimal(14,2) NOT NULL,
  `total` decimal(14,2) NOT NULL,
  `idempotency_key` varchar(100) NOT NULL,
  `request_fingerprint` char(64) NOT NULL,
  `actor_user_id` varchar(36) NOT NULL,
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_purchase_receipts_tenant_idempotency` (`tenant_id`,`idempotency_key`),
  UNIQUE KEY `UQ_purchase_receipts_tenant_id` (`tenant_id`,`id`),
  KEY `IDX_purchase_receipts_order` (`tenant_id`,`purchase_order_id`),
  KEY `IDX_purchase_receipts_tenant_branch_created` (`tenant_id`,`branch_id`,`created_at`),
  KEY `FK_purchase_receipts_order` (`purchase_order_id`),
  CONSTRAINT `FK_purchase_receipts_order` FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `roles` (
  `id` varchar(36) NOT NULL,
  `name` enum('SUPER_ADMIN','ADMIN','MANAGER','CASHIER','WAREHOUSE','USER','SELLER','STOCK_CLERK') NOT NULL DEFAULT 'USER',
  `description` varchar(255) DEFAULT NULL,
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `deleted_at` timestamp(6) NULL DEFAULT NULL,
  `is_active` tinyint NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_648e3f5447f725579d7d4ffdfb` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `sale_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sale_items` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `sale_id` varchar(36) NOT NULL,
  `product_id` varchar(36) NOT NULL,
  `sku_snapshot` varchar(50) NOT NULL,
  `name_snapshot` varchar(150) NOT NULL,
  `quantity` decimal(12,3) NOT NULL,
  `unit_price` decimal(12,2) NOT NULL,
  `tax_rate` decimal(5,2) NOT NULL,
  `net_amount` decimal(14,2) NOT NULL,
  `tax_amount` decimal(14,2) NOT NULL,
  `vat_treatment` varchar(20) DEFAULT NULL,
  `arca_vat_rate_id` smallint unsigned DEFAULT NULL,
  `price_includes_vat` tinyint NOT NULL DEFAULT '0',
  `exempt_amount` decimal(14,2) NOT NULL DEFAULT '0.00',
  `not_taxed_amount` decimal(14,2) NOT NULL DEFAULT '0.00',
  `total` decimal(14,2) NOT NULL,
  `unit_cost` decimal(12,2) NOT NULL DEFAULT '0.00',
  `discount_amount` decimal(14,2) NOT NULL DEFAULT '0.00',
  `promotion_id` varchar(36) DEFAULT NULL,
  `promotion_name` varchar(120) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `IDX_sale_items_tenant_sale` (`tenant_id`,`sale_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `sale_payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sale_payments` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `sale_id` varchar(36) NOT NULL,
  `method` enum('CASH','DEBIT_CARD','CREDIT_CARD','BANK_TRANSFER','QR','OTHER') NOT NULL,
  `amount` decimal(14,2) NOT NULL,
  `currency` char(3) NOT NULL,
  `external_reference` varchar(100) DEFAULT NULL,
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `IDX_sale_payments_tenant_sale` (`tenant_id`,`sale_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `sale_return_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sale_return_items` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `sale_return_id` varchar(36) NOT NULL,
  `sale_item_id` varchar(36) NOT NULL,
  `product_id` varchar(36) NOT NULL,
  `quantity` decimal(12,3) NOT NULL,
  `net_amount` decimal(14,2) NOT NULL,
  `tax_amount` decimal(14,2) NOT NULL,
  `exempt_amount` decimal(14,2) NOT NULL DEFAULT '0.00',
  `not_taxed_amount` decimal(14,2) NOT NULL DEFAULT '0.00',
  `total` decimal(14,2) NOT NULL,
  `unit_cost` decimal(12,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  KEY `IDX_sale_return_items_sale_item` (`tenant_id`,`sale_item_id`),
  KEY `IDX_sale_return_items_return` (`tenant_id`,`sale_return_id`),
  KEY `FK_sale_return_items_return` (`sale_return_id`),
  KEY `FK_sale_return_items_sale_item` (`sale_item_id`),
  CONSTRAINT `FK_sale_return_items_return` FOREIGN KEY (`sale_return_id`) REFERENCES `sale_returns` (`id`) ON DELETE CASCADE,
  CONSTRAINT `FK_sale_return_items_sale_item` FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `sale_returns`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sale_returns` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `number` int unsigned NOT NULL,
  `sale_id` varchar(36) NOT NULL,
  `branch_id` varchar(36) NOT NULL,
  `reason` varchar(200) NOT NULL,
  `restock` tinyint NOT NULL DEFAULT '1',
  `refund_method` enum('CASH','ORIGINAL_METHOD','STORE_CREDIT') NOT NULL,
  `cash_session_id` varchar(36) DEFAULT NULL,
  `external_reference` varchar(100) DEFAULT NULL,
  `subtotal` decimal(14,2) NOT NULL,
  `tax_total` decimal(14,2) NOT NULL,
  `total` decimal(14,2) NOT NULL,
  `currency` char(3) NOT NULL,
  `fiscal_status` varchar(20) NOT NULL DEFAULT 'NOT_ISSUED',
  `idempotency_key` varchar(100) NOT NULL,
  `request_fingerprint` char(64) NOT NULL,
  `actor_user_id` varchar(36) NOT NULL,
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_sale_returns_tenant_idempotency` (`tenant_id`,`idempotency_key`),
  UNIQUE KEY `UQ_sale_returns_tenant_number` (`tenant_id`,`number`),
  KEY `IDX_sale_returns_branch_created` (`tenant_id`,`branch_id`,`created_at`),
  KEY `IDX_sale_returns_sale` (`tenant_id`,`sale_id`),
  KEY `FK_sale_returns_sale` (`sale_id`),
  CONSTRAINT `FK_sale_returns_sale` FOREIGN KEY (`sale_id`) REFERENCES `sales` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `FK_sale_returns_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `sales`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sales` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `branch_id` varchar(36) NOT NULL,
  `customer_person_id` varchar(36) DEFAULT NULL,
  `currency` char(3) NOT NULL,
  `subtotal` decimal(14,2) NOT NULL,
  `tax_total` decimal(14,2) NOT NULL,
  `net_taxed_total` decimal(14,2) NOT NULL DEFAULT '0.00',
  `discount_total` decimal(14,2) NOT NULL DEFAULT '0.00',
  `exempt_total` decimal(14,2) NOT NULL DEFAULT '0.00',
  `not_taxed_total` decimal(14,2) NOT NULL DEFAULT '0.00',
  `voucher_class` char(1) DEFAULT NULL,
  `vat_charge_mode` varchar(30) DEFAULT NULL,
  `issuer_vat_condition` varchar(40) DEFAULT NULL,
  `customer_vat_condition` varchar(40) DEFAULT NULL,
  `vat_exemption_reason` varchar(30) DEFAULT NULL,
  `vat_exemption_note` varchar(200) DEFAULT NULL,
  `total` decimal(14,2) NOT NULL,
  `fiscal_status` enum('NOT_ISSUED','PENDING','AUTHORIZED','REJECTED','FAILED') NOT NULL DEFAULT 'NOT_ISSUED',
  `return_status` enum('NONE','PARTIAL','FULL') NOT NULL DEFAULT 'NONE',
  `refunded_total` decimal(14,2) NOT NULL DEFAULT '0.00',
  `idempotency_key` varchar(100) NOT NULL,
  `request_fingerprint` char(64) NOT NULL,
  `actor_user_id` varchar(36) NOT NULL,
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_sales_tenant_idempotency` (`tenant_id`,`idempotency_key`),
  UNIQUE KEY `UQ_sales_tenant_id` (`tenant_id`,`id`),
  KEY `IDX_sales_tenant_customer` (`tenant_id`,`customer_person_id`,`created_at`),
  KEY `IDX_sales_tenant_created` (`tenant_id`,`created_at`),
  KEY `IDX_sales_tenant_branch_created` (`tenant_id`,`branch_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `stock_transfer_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `stock_transfer_items` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `transfer_id` varchar(36) NOT NULL,
  `product_id` varchar(36) NOT NULL,
  `sku_snapshot` varchar(50) NOT NULL,
  `name_snapshot` varchar(150) NOT NULL,
  `quantity_sent` decimal(12,3) NOT NULL,
  `quantity_received` decimal(12,3) DEFAULT NULL,
  `unit_cost` decimal(12,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `IDX_stock_transfer_items_product` (`tenant_id`,`product_id`),
  KEY `IDX_stock_transfer_items_transfer` (`tenant_id`,`transfer_id`),
  KEY `FK_stock_transfer_items_transfer` (`transfer_id`),
  KEY `FK_stock_transfer_items_product` (`product_id`),
  CONSTRAINT `FK_stock_transfer_items_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `FK_stock_transfer_items_transfer` FOREIGN KEY (`transfer_id`) REFERENCES `stock_transfers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `stock_transfers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `stock_transfers` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `number` int unsigned NOT NULL,
  `origin_branch_id` varchar(36) NOT NULL,
  `destination_branch_id` varchar(36) NOT NULL,
  `status` enum('SENT','RECEIVED','CANCELLED') NOT NULL DEFAULT 'SENT',
  `notes` varchar(500) DEFAULT NULL,
  `sent_by_user_id` varchar(36) NOT NULL,
  `received_by_user_id` varchar(36) DEFAULT NULL,
  `received_at` timestamp(6) NULL DEFAULT NULL,
  `receipt_notes` varchar(500) DEFAULT NULL,
  `cancelled_by_user_id` varchar(36) DEFAULT NULL,
  `cancelled_at` timestamp(6) NULL DEFAULT NULL,
  `cancel_reason` varchar(200) DEFAULT NULL,
  `idempotency_key` varchar(100) NOT NULL,
  `request_fingerprint` char(64) NOT NULL,
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_stock_transfers_tenant_number` (`tenant_id`,`number`),
  UNIQUE KEY `UQ_stock_transfers_tenant_idempotency` (`tenant_id`,`idempotency_key`),
  KEY `IDX_stock_transfers_destination` (`tenant_id`,`destination_branch_id`,`status`,`created_at`),
  KEY `IDX_stock_transfers_origin` (`tenant_id`,`origin_branch_id`,`status`,`created_at`),
  KEY `FK_stock_transfers_origin` (`origin_branch_id`),
  KEY `FK_stock_transfers_destination` (`destination_branch_id`),
  CONSTRAINT `FK_stock_transfers_destination` FOREIGN KEY (`destination_branch_id`) REFERENCES `branches` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `FK_stock_transfers_origin` FOREIGN KEY (`origin_branch_id`) REFERENCES `branches` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `FK_stock_transfers_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `supplier_payables`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `supplier_payables` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `branch_id` varchar(36) NOT NULL,
  `supplier_person_id` varchar(36) NOT NULL,
  `purchase_receipt_id` varchar(36) NOT NULL,
  `currency` char(3) NOT NULL,
  `original_amount` decimal(14,2) NOT NULL,
  `amount_paid` decimal(14,2) NOT NULL DEFAULT '0.00',
  `due_date` date DEFAULT NULL,
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_supplier_payables_tenant_receipt` (`tenant_id`,`purchase_receipt_id`),
  UNIQUE KEY `UQ_supplier_payables_tenant_id` (`tenant_id`,`id`),
  KEY `IDX_supplier_payables_tenant_branch_created` (`tenant_id`,`branch_id`,`created_at`,`id`),
  KEY `IDX_supplier_payables_tenant_supplier_due` (`tenant_id`,`supplier_person_id`,`due_date`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `supplier_payment_allocations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `supplier_payment_allocations` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `payment_id` varchar(36) NOT NULL,
  `payable_id` varchar(36) NOT NULL,
  `amount` decimal(14,2) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_supplier_payment_allocations_tenant_payment_payable` (`tenant_id`,`payment_id`,`payable_id`),
  KEY `IDX_supplier_payment_allocations_tenant_payable` (`tenant_id`,`payable_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `supplier_payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `supplier_payments` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `branch_id` varchar(36) NOT NULL,
  `supplier_person_id` varchar(36) NOT NULL,
  `currency` char(3) NOT NULL,
  `method` enum('CASH','BANK_TRANSFER','CHECK','CARD','OTHER') NOT NULL,
  `amount` decimal(14,2) NOT NULL,
  `external_reference` varchar(100) DEFAULT NULL,
  `idempotency_key` varchar(100) NOT NULL,
  `request_fingerprint` char(64) NOT NULL,
  `actor_user_id` varchar(36) NOT NULL,
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_supplier_payments_tenant_idempotency` (`tenant_id`,`idempotency_key`),
  UNIQUE KEY `UQ_supplier_payments_tenant_id` (`tenant_id`,`id`),
  KEY `IDX_supplier_payments_tenant_supplier_created` (`tenant_id`,`supplier_person_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `tenant_memberships`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tenant_memberships` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `branch_id` varchar(36) DEFAULT NULL,
  `role` enum('OWNER','ADMIN','MANAGER','ACCOUNTANT','CASHIER','INVENTORY','SELLER','VIEWER') NOT NULL,
  `status` enum('INVITED','ACTIVE','SUSPENDED') NOT NULL DEFAULT 'INVITED',
  `accepted_at` timestamp(6) NULL DEFAULT NULL,
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_tenant_membership_tenant_user` (`tenant_id`,`user_id`),
  KEY `IDX_tenant_membership_user_status` (`user_id`,`status`),
  KEY `FK_df584414136bcd73cb0a013e7f8` (`branch_id`),
  CONSTRAINT `FK_7427b391abdef33b40124c15822` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `FK_d22937ebccd641b5090849e51f7` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `FK_df584414136bcd73cb0a013e7f8` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `tenants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tenants` (
  `id` varchar(36) NOT NULL,
  `slug` varchar(80) NOT NULL,
  `legal_name` varchar(200) NOT NULL,
  `trade_name` varchar(200) DEFAULT NULL,
  `tax_id` varchar(11) DEFAULT NULL,
  `status` enum('TRIAL','ACTIVE','SUSPENDED','CLOSED') NOT NULL DEFAULT 'TRIAL',
  `time_zone` varchar(64) NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
  `currency_code` char(3) NOT NULL DEFAULT 'ARS',
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_tenants_slug` (`slug`),
  UNIQUE KEY `UQ_tenants_tax_id` (`tax_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `typeorm_metadata`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `typeorm_metadata` (
  `type` varchar(255) NOT NULL,
  `database` varchar(255) DEFAULT NULL,
  `schema` varchar(255) DEFAULT NULL,
  `table` varchar(255) DEFAULT NULL,
  `name` varchar(255) DEFAULT NULL,
  `value` text
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `user_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_sessions` (
  `id` varchar(36) NOT NULL,
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `deleted_at` timestamp(6) NULL DEFAULT NULL,
  `user_id` varchar(36) NOT NULL,
  `token_id` varchar(36) NOT NULL,
  `refresh_token_hash` varchar(500) NOT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  `is_valid` tinyint NOT NULL DEFAULT '1',
  `expires_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_user_sessions_token_id` (`token_id`),
  KEY `IDX_e9658e959c490b0a634dfc5478` (`user_id`),
  CONSTRAINT `FK_e9658e959c490b0a634dfc54783` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` varchar(36) NOT NULL,
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `deleted_at` timestamp(6) NULL DEFAULT NULL,
  `username` varchar(150) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `isActive` tinyint NOT NULL DEFAULT '1',
  `current_hashed_refresh_token` varchar(500) DEFAULT NULL,
  `person_id` varchar(255) NOT NULL,
  `branch_id` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_users_username` (`username`),
  UNIQUE KEY `REL_5ed72dcd00d6e5a88c6a6ba3d1` (`person_id`),
  KEY `FK_5a58f726a41264c8b3e86d4a1de` (`branch_id`),
  CONSTRAINT `FK_5a58f726a41264c8b3e86d4a1de` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE SET NULL,
  CONSTRAINT `FK_5ed72dcd00d6e5a88c6a6ba3d18` FOREIGN KEY (`person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `users_roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users_roles` (
  `user_id` varchar(36) NOT NULL,
  `role_id` varchar(36) NOT NULL,
  PRIMARY KEY (`user_id`,`role_id`),
  KEY `IDX_e4435209df12bc1f001e536017` (`user_id`),
  KEY `IDX_1cf664021f00b9cc1ff95e17de` (`role_id`),
  CONSTRAINT `FK_1cf664021f00b9cc1ff95e17de4` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `FK_e4435209df12bc1f001e5360174` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

