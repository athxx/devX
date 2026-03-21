package db

import (
	"fmt"
	"strings"
)

func DisconnectConnection(kind, driver, dsn, url, uri string) error {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "redis":
		return DisconnectRedisClient(url)
	case "mongodb", "mongo":
		return DisconnectMongoClient(uri)
	default:
		if strings.TrimSpace(driver) == "" {
			driver = kind
		}
		if strings.TrimSpace(driver) == "" || strings.TrimSpace(dsn) == "" {
			return fmt.Errorf("driver and dsn are required")
		}
		return DisconnectSQLConnection(driver, dsn)
	}
}
