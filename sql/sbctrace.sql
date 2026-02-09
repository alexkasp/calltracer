-- БД: sbclogs (параметры из .env MANAGER_DB_*)
CREATE TABLE IF NOT EXISTS `sbctrace` (
  `id` int NOT NULL AUTO_INCREMENT,
  `payload` json DEFAULT NULL,
  `called` varchar(255) DEFAULT NULL,
  `calling` varchar(255) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_called` (`called`),
  KEY `idx_calling` (`calling`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
