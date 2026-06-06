#!/usr/bin/env bash
set -euo pipefail

min_percent="${ABG_SWIFT_COVERAGE_MIN:-60}"
coverage_json="${1:-}"

if [[ -z "$coverage_json" ]]; then
  coverage_json="$(swift test --show-codecov-path | tail -n 1)"
fi

if [[ ! -f "$coverage_json" ]]; then
  echo "Swift coverage JSON not found: $coverage_json" >&2
  echo "Run: swift test --enable-code-coverage" >&2
  exit 1
fi

ruby -rjson - "$coverage_json" "$min_percent" <<'RUBY'
coverage_json = ARGV.fetch(0)
min_percent = Float(ARGV.fetch(1))

service_suffixes = [
  "Sources/Gateway/AuditLog.swift",
  "Sources/Gateway/PluginHost.swift",
  "Sources/Gateway/WSServer.swift",
  "Sources/GatewayCore/Constants.swift",
  "Sources/GatewayCore/PluginInstaller.swift",
  "Sources/GatewayCore/PluginStateStore.swift"
]

payload = JSON.parse(File.read(coverage_json))
files = payload.fetch("data").flat_map { |entry| entry.fetch("files") }
selected = service_suffixes.map do |suffix|
  files.find { |file| file.fetch("filename").end_with?(suffix) }
end

missing = service_suffixes.zip(selected).select { |_, file| file.nil? }.map(&:first)
unless missing.empty?
  warn "Missing Swift coverage entries:"
  missing.each { |suffix| warn "  - #{suffix}" }
  exit 1
end

puts "Swift service coverage:"
covered = 0
count = 0

service_suffixes.zip(selected).each do |suffix, file|
  lines = file.fetch("summary").fetch("lines")
  file_count = Integer(lines.fetch("count"))
  file_covered = Integer(lines.fetch("covered"))
  file_percent = file_count.zero? ? 100.0 : (file_covered * 100.0 / file_count)
  covered += file_covered
  count += file_count
  puts format("  %-48s %6.2f%% (%d/%d lines)", suffix, file_percent, file_covered, file_count)
end

percent = count.zero? ? 100.0 : (covered * 100.0 / count)
puts format("  %-48s %6.2f%% (%d/%d lines)", "TOTAL", percent, covered, count)

if percent < min_percent
  warn format("Swift service coverage %.2f%% is below %.2f%%", percent, min_percent)
  exit 1
end
RUBY
