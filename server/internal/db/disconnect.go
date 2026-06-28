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
	case "elasticsearch":
		return DisconnectESClient(url)
	case "bigtable":
		// url carries "project\x00instance" (see BigtableAdapter.buildDisconnectMessage).
		return DisconnectBigtableClient(url)
	case "qdrant":
		return DisconnectQdrantClient(url)
	case "influxdb", "influx":
		return DisconnectInfluxClient(url)
	case "weaviate":
		return DisconnectWeaviateClient(url)
	case "neo4j":
		return DisconnectNeo4jClient(url)
	case "cassandra":
		return DisconnectCassandraClient(url)
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
