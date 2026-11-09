-- Admins can grant and remove the admin role from the console (audited by the existing
-- user_roles trigger). Two safeguards, enforced in the database:
--   * nobody removes their own admin role (so you can't lock yourself out by accident)
--   * the last admin can never be removed

GRANT DELETE ON user_roles TO app_user;

CREATE POLICY user_roles_admin_delete ON user_roles FOR DELETE TO app_user USING (app.is_admin());

CREATE OR REPLACE FUNCTION app.user_roles_guard_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.role = 'admin' THEN
    IF OLD.person_id = app.current_person_id() THEN
      RAISE EXCEPTION 'You can''t remove your own admin role. Ask another admin.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM user_roles WHERE role = 'admin' AND person_id <> OLD.person_id) THEN
      RAISE EXCEPTION 'The last admin can''t be removed.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN OLD;
END
$$;

CREATE TRIGGER user_roles_guard_delete BEFORE DELETE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION app.user_roles_guard_delete();

-- Only people who can sign in (employees and outside investors with an email) can be admins.
CREATE OR REPLACE FUNCTION app.user_roles_guard_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.person_id AND email IS NOT NULL AND status <> 'departed') THEN
    RAISE EXCEPTION 'Only a current person with an email can be an admin.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER user_roles_guard_insert BEFORE INSERT ON user_roles
  FOR EACH ROW EXECUTE FUNCTION app.user_roles_guard_insert();

GRANT EXECUTE ON FUNCTION app.user_roles_guard_delete(), app.user_roles_guard_insert() TO app_user;
