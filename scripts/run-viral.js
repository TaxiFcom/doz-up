#!/usr/bin/env node
/**
 * Run DOZ UP Viral Engine Directly
 */

const { ViralEngine } = require('../services/viral-engine');

const engine = new ViralEngine();

console.log('Starting DOZ UP Viral Engine...\n');

engine.runFullCampaign().then(stats => {
    console.log('\n\nFinal Stats:', JSON.stringify(stats, null, 2));
    process.exit(0);
}).catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
