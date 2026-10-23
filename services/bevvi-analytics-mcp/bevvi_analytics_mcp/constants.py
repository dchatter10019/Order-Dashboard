ALLOWED_TOOLS = frozenset(
    {
        "bevvi_analysis_data_quality",
        "bevvi_period_comparison",
        "bevvi_customer_trends",
        "bevvi_planning_forecast",
    }
)

REQUIRED_SCOPE = "analytics:read"
PLANNING_MODEL_ALLOWED = "planning_blend_v1"

# Reviewed analytics source (Computer workspace); record at deploy time.
REVIEW_ANALYTICS_SOURCE_COMMIT = "a4e707f7b8d3251677f5cdfcb71d2ead5adf7514"
DEFAULT_ANALYTICS_SOURCE_COMMIT = REVIEW_ANALYTICS_SOURCE_COMMIT
