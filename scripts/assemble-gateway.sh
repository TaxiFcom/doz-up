#!/bin/bash
cat gateway-segments/seg_*.js > gateway.js
echo "gateway.js assembled: $(wc -l < gateway.js) lines"
rm -rf gateway-segments/
