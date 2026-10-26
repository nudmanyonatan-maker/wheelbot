#!/bin/sh
# Prints the latest feedback sent from the private desks, newest first.
cd "$(dirname "$0")/.." && npx wrangler d1 execute iso-desk --remote --command "SELECT datetime(f.created / 1000, 'unixepoch', 'localtime') AS sent, u.name, f.page, f.text FROM feedback f LEFT JOIN users u ON u.id = f.user_id ORDER BY f.created DESC LIMIT 50"
