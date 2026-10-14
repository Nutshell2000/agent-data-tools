#!/usr/bin/env pwsh
# Daily metrics monitor for Agent Data Tools
# Tracks progress toward 50,000 kr/month revenue goal
# Run daily: .\monitor-metrics.ps1

param(
  [switch]$email,
  [string]$to = "spellz111122@gmail.com"
)

$apiBase = "https://agent-data-tools.revmesh2074.workers.dev"

Write-Host "📊 Agent Data Tools - Daily Metrics Report" -ForegroundColor Cyan
Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss UTC')" -ForegroundColor Gray

# Fetch metrics
try {
  $metrics = (curl -s "$apiBase/metrics" | ConvertFrom-Json)
} catch {
  Write-Host "❌ Failed to fetch metrics" -ForegroundColor Red
  exit 1
}

# Extract today's data
$today = (Get-Date).ToString("yyyy-MM-dd")
$today_data = $metrics.$today

if (-not $today_data) {
  Write-Host "⏳ No data yet for today. Check back later." -ForegroundColor Yellow
  exit 0
}

# Calculate totals
$paid_calls = 0
$trial_calls = 0
$challenged_calls = 0
$failed_calls = 0

foreach ($endpoint in $today_data.PSObject.Properties) {
  $ep = $endpoint.Value
  $paid_calls += $ep.paid ?? 0
  $trial_calls += $ep.trial ?? 0
  $challenged_calls += $ep.challenged ?? 0
  $failed_calls += $ep.failed ?? 0
}

# Revenue estimate (avg $0.02/call)
$estimated_revenue = $paid_calls * 0.02
$kr_rate = 0.002  # 1 USD ≈ 0.2 SEK, so 1 call at $0.02 ≈ 0.004 kr? Adjust based on actual rates
# Actually: 50,000 kr ≈ $5,200, so rate is approx 0.104 kr/USD
$estimated_kr_daily = $estimated_revenue * 10.4

Write-Host "`n📈 Today's Summary ($today)" -ForegroundColor Green
Write-Host "  Paid calls:        $paid_calls" -ForegroundColor Cyan
Write-Host "  Trial calls:       $trial_calls" -ForegroundColor Cyan
Write-Host "  Challenged (402):  $challenged_calls" -ForegroundColor Gray
Write-Host "  Failed:            $failed_calls" -ForegroundColor Red

Write-Host "`n💰 Revenue Estimate" -ForegroundColor Green
Write-Host "  Today (USD):       `$$estimated_revenue" -ForegroundColor Cyan
Write-Host "  Today (kr):        ~$([math]::Round($estimated_kr_daily, 2)) kr" -ForegroundColor Cyan
Write-Host "  Month (annualized): ~$([math]::Round($estimated_revenue * 30, 2)) USD" -ForegroundColor Cyan
Write-Host "  Goal:              50,000 kr/month (~\$5,200)" -ForegroundColor Yellow

# Last 7 days trend
Write-Host "`n📊 Last 7 Days Trend" -ForegroundColor Green
$past_7_days = @()
for ($i = 6; $i -ge 0; $i--) {
  $date = (Get-Date).AddDays(-$i).ToString("yyyy-MM-dd")
  $data = $metrics.$date
  if ($data) {
    $paid = 0
    foreach ($ep in $data.PSObject.Properties) {
      $paid += $ep.Value.paid ?? 0
    }
    $past_7_days += @{date=$date; paid=$paid}
  }
}

if ($past_7_days.Count -gt 0) {
  $past_7_days | ForEach-Object {
    $bar = [string]::new('█', [math]::Max($_.paid, 1))
    Write-Host "  $($_.date): $($_.paid) calls $bar" -ForegroundColor Cyan
  }
  $avg_7d = ($past_7_days | Measure-Object -Property paid -Average).Average
  Write-Host "  Average: $([math]::Round($avg_7d, 1)) calls/day" -ForegroundColor Cyan
  $growth = if ($past_7_days[0].paid -gt 0) { ($past_7_days[-1].paid / $past_7_days[0].paid - 1) * 100 } else { 0 }
  Write-Host "  7-day growth: $([math]::Round($growth, 1))%" -ForegroundColor $(if ($growth -gt 0) { "Green" } else { "Red" })
}

# Top endpoints today
Write-Host "`n🔝 Top Endpoints (Paid + Trial)" -ForegroundColor Green
$top_endpoints = @()
foreach ($endpoint in $today_data.PSObject.Properties) {
  $ep_name = $endpoint.Name
  $ep_data = $endpoint.Value
  $total = ($ep_data.paid ?? 0) + ($ep_data.trial ?? 0)
  if ($total -gt 0) {
    $top_endpoints += @{name=$ep_name; total=$total; paid=$ep_data.paid ?? 0; trial=$ep_data.trial ?? 0}
  }
}

$top_endpoints | Sort-Object total -Descending | Select-Object -First 5 | ForEach-Object {
  Write-Host "  $($_.name): $($_.total) calls (P:$($_.paid) T:$($_.trial))" -ForegroundColor Cyan
}

# Status
Write-Host "`n🎯 Status vs. Goal" -ForegroundColor Green
$calls_needed = [math]::Ceiling(50000 / (10.4 * 30))  # calls needed per day to hit goal
$current_daily_avg = if ($past_7_days.Count -gt 0) { ($past_7_days | Measure-Object -Property paid -Average).Average } else { 1 }
$gap = $calls_needed - $current_daily_avg
Write-Host "  Current (7d avg): $([math]::Round($current_daily_avg, 1)) calls/day" -ForegroundColor Cyan
Write-Host "  Needed for goal:  ~$calls_needed calls/day" -ForegroundColor Yellow
Write-Host "  Gap:              +$([math]::Round([math]::Max($gap, 0), 1)) calls/day" -ForegroundColor $(if ($gap -le 0) { "Green" } else { "Red" })

# Alerts
Write-Host "`n⚠️  Alerts" -ForegroundColor Green
if ($paid_calls -eq 0) {
  Write-Host "  ⚠️  No paid calls today. Check if outreach is running." -ForegroundColor Yellow
} elseif ($paid_calls -gt ($past_7_days | Measure-Object -Property paid -Average).Average * 3) {
  Write-Host "  ✅ SPIKE! Paid calls up $([math]::Round($paid_calls / (($past_7_days | Measure-Object -Property paid -Average).Average), 1))x today" -ForegroundColor Green
}

if ($trial_calls -gt 0 -and $paid_calls -eq 0) {
  Write-Host "  📊 Trials active but no conversions yet. Monitor conversion rate." -ForegroundColor Cyan
}

Write-Host "`n✅ Report generated at $(Get-Date -Format 'HH:mm:ss UTC')" -ForegroundColor Green

# Optional: Email report
if ($email) {
  Write-Host "`n📧 Email functionality not yet implemented. Update to use: spellz111122@gmail.com" -ForegroundColor Gray
}

# Exit code for automation
if ($paid_calls -eq 0) { exit 1 } else { exit 0 }
