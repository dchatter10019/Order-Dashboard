# Bevvi Analytics MCP rollback

1. **Traffic:** remove or repoint the ALB target group rule for `https://mcp.getbevvi.com/analytics` to the previous release (prior AMI/systemd unit revision).
2. **Service:** `systemctl stop bevvi-analytics-mcp` on the new instance; confirm health checks fail closed.
3. **Release artifact:** redeploy the previous pinned wheel/commit from `/opt/bevvi-analytics-mcp/releases/<previous>/`.
4. **Data generation:** pin `BEVVI_ANALYTICS_MCP_SNAPSHOT_GENERATION` to the last known-good immutable snapshot generation (never mix files across generations).
5. **Verify:** Cursor and claude.ai OAuth + one read-only tool call against the rolled-back endpoint; confirm logs contain no secrets.

Do not restart or mutate the legacy Node analytics gateway as part of this rollback.
