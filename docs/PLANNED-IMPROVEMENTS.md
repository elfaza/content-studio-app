# Planned improvements

## Platform-specific duration and analytics

Recorded from the user's discussion on 2026-11-04. Implemented as described below; release verification is recorded in deployment.json.

- Keep one content idea even when it is published on multiple platforms.
- Keep the idea's target duration as a production planning value.
- Record actual published duration separately for each platform posting, alongside its published link. Instagram and TikTok versions may have different durations.
- Use the corresponding posting's duration for platform-specific watch-percentage calculations.
- Preserve existing duration data. Do not invent platform-specific durations for older posts; show missing values as missing until entered.
- Separate analytics by platform. Do not combine Instagram, TikTok, and YouTube views into the primary views figure or chart: the combined number is confusing for the user's workflow.
- Present platform metrics with an explicit platform context so users can compare performance without mistaking a cross-platform sum for a single-platform result.
- Keep one Published Content card per content item, with separate platform sections inside it. Each section shows actual duration, latest views, latest likes, average watched percentage, and its own observation date.
- Keep one Add snapshot button per card, followed by platform selection. Observation history has a platform filter.
- Dashboard and Analytics use Instagram, TikTok, and YouTube buttons with a remembered selection. All performance totals, charts, rankings, and category comparisons follow that selection. The dashboard's production queue remains workspace-wide.

Platform durations are optional and persist in the existing metadata sidecar; original sheet columns and shared legacy duration values are preserved. Missing or zero actual duration does not produce a watch percentage. Average watched percentage may exceed 100% for looping content. Date ranges select observations, and the most recent observation per content/platform inside the range supplies headline metrics; historical observations are never added to the headline total.
