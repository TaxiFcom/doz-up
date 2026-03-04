#!/bin/bash
# Assemble gateway.js from segments
cd "$(dirname "$0")/.."
cat gateway-segments/segment-01 gateway-segments/segment-02 gateway-segments/segment-03 gateway-segments/segment-04 > gateway.js
echo "gateway.js assembled ($(wc -l < gateway.js) lines)"
