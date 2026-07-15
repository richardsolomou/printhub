UPDATE requests
SET
  requester_email = (
    SELECT email
    FROM "user"
    WHERE trim(name) = trim(requests.requester_name) COLLATE NOCASE
    LIMIT 1
  ),
  requester_name = (
    SELECT name
    FROM "user"
    WHERE trim(name) = trim(requests.requester_name) COLLATE NOCASE
    LIMIT 1
  )
WHERE trim(coalesce(requester_name, '')) <> ''
  AND (
    SELECT count(*)
    FROM "user"
    WHERE trim(name) = trim(requests.requester_name) COLLATE NOCASE
  ) = 1;

UPDATE requests
SET requester_name = (
  SELECT name
  FROM "user"
  WHERE email = requests.requester_email COLLATE NOCASE
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM "user"
  WHERE email = requests.requester_email COLLATE NOCASE
);
