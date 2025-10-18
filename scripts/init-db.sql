-- BerthCare Database Initialization Script
-- This script runs automatically when PostgreSQL container starts for the first time
-- Creates test database and enables required extensions

-- Create test database for running tests
CREATE DATABASE berthcare_test;

-- Connect to main database
\c berthcare_dev;

-- Enable UUID extension for generating unique identifiers
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enable PostGIS extension for geospatial queries (GPS coordinates)
-- Commented out by default - uncomment if you need geospatial features
-- CREATE EXTENSION IF NOT EXISTS postgis;

-- Create a simple health check table
CREATE TABLE IF NOT EXISTS health_check (
    id SERIAL PRIMARY KEY,
    status VARCHAR(50) NOT NULL DEFAULT 'healthy',
    last_check TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert initial health check record
INSERT INTO health_check (status) VALUES ('healthy');

-- Connect to test database and set it up
\c berthcare_test;

-- Enable UUID extension in test database
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create health check table in test database
CREATE TABLE IF NOT EXISTS health_check (
    id SERIAL PRIMARY KEY,
    status VARCHAR(50) NOT NULL DEFAULT 'healthy',
    last_check TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO health_check (status) VALUES ('healthy');

-- Success message
SELECT 'BerthCare databases initialized successfully!' AS message;
