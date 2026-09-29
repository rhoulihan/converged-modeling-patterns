-- app/sql/bootstrap.sql
-- Idempotent. Run once at lab-ui start-up as SYS AS SYSDBA connected to FREEPDB1.
-- Creates LAB_ADMIN (least privilege for provisioning attendee workspaces), the control
-- tables, and the V$ grants measure-it needs. :pw is bound to LAB_ADMIN_PASSWORD.
DECLARE
  PROCEDURE x(p_sql VARCHAR2, p_ok1 PLS_INTEGER DEFAULT 0, p_ok2 PLS_INTEGER DEFAULT 0) IS
  BEGIN
    EXECUTE IMMEDIATE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLCODE NOT IN (p_ok1, p_ok2) THEN RAISE; END IF;
  END;
BEGIN
  x('CREATE USER lab_admin IDENTIFIED BY "' || :pw || '" QUOTA 100M ON users', -1920);
  x('ALTER USER lab_admin IDENTIFIED BY "' || :pw || '"');
  x('GRANT CREATE SESSION, CREATE TABLE TO lab_admin');
  x('GRANT CREATE USER, ALTER USER, DROP USER TO lab_admin');
  x('GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE PROCEDURE, CREATE TRIGGER, CREATE SEQUENCE, '
    || 'CREATE MATERIALIZED VIEW, CREATE PROPERTY GRAPH TO lab_admin WITH ADMIN OPTION');
  x('GRANT SODA_APP TO lab_admin WITH ADMIN OPTION');
  x('GRANT SELECT ON sys.v_$mystat TO lab_admin WITH GRANT OPTION');
  x('GRANT SELECT ON sys.v_$statname TO lab_admin WITH GRANT OPTION');
  x('GRANT SELECT ON sys.v_$session TO lab_admin');
  x('GRANT SELECT ON sys.v_$mystat TO cmp_user');
  x('GRANT SELECT ON sys.v_$statname TO cmp_user');
  x('GRANT ORDS_ADMINISTRATOR_ROLE TO lab_admin', -1919);  -- role exists once ORDS is installed
  x('CREATE TABLE lab_admin.lab_users (schema_name VARCHAR2(30) PRIMARY KEY, schema_password VARCHAR2(64) NOT NULL, '
    || 'email VARCHAR2(320) UNIQUE, display_name VARCHAR2(200), created_at TIMESTAMP DEFAULT SYSTIMESTAMP, assigned_at TIMESTAMP)', -955);
  x('CREATE TABLE lab_admin.lab_dirty (schema_name VARCHAR2(30), pattern_id VARCHAR2(64), '
    || 'CONSTRAINT lab_dirty_pk PRIMARY KEY (schema_name, pattern_id))', -955);
  x('CREATE TABLE lab_admin.lab_built (schema_name VARCHAR2(30), pattern_id VARCHAR2(64), version VARCHAR2(16) NOT NULL, '
    || 'CONSTRAINT lab_built_pk PRIMARY KEY (schema_name, pattern_id))', -955);
  x('CREATE TABLE lab_admin.lab_settings (k VARCHAR2(64) PRIMARY KEY, v VARCHAR2(4000))', -955);
  x('CREATE TABLE lab_admin.lab_pending_drop (schema_name VARCHAR2(30) PRIMARY KEY, '
    || 'requested_at TIMESTAMP DEFAULT SYSTIMESTAMP, last_error VARCHAR2(400))', -955);
END;
/
