# Analytics gateway rollback (EC2)

1. `sudo systemctl stop bevvi-analytics-gateway`
2. `sudo systemctl disable bevvi-analytics-gateway`
3. Remove the `/analytics` and `/analytics/health` location blocks from Nginx (additive snippet only).
4. `sudo nginx -t && sudo systemctl reload nginx`
5. Verify legacy routes: `/mcp`, `/rachel/`, `/whatsapp/` unchanged.

Do **not** revert `bevvi-mcp.service`, Rachel OAuth metadata, or Computer/cron_tracking data.
