export function migrateMembershipFix(db){db.exec('DROP TRIGGER IF EXISTS member_auth_DELETE');}
