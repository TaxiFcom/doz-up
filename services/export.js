/**
 * DOZ UP - Export Service
 * Export data to CSV, JSON, and generate reports
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const dataDir = path.join(__dirname, '..', 'data');
const exportDir = path.join(__dirname, '..', 'exports');

// Ensure export directory exists
if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
}

class ExportService {
    constructor() {
        // Cleanup old exports periodically
        setInterval(() => this.cleanupOldExports(), 60 * 60 * 1000);
    }

    // ============ CSV EXPORT ============

    toCSV(data, columns = null) {
        if (!Array.isArray(data) || data.length === 0) {
            return '';
        }

        // Auto-detect columns if not provided
        const cols = columns || Object.keys(data[0]);

        // Escape CSV value
        const escapeCSV = (value) => {
            if (value === null || value === undefined) return '';
            const str = String(value);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        // Header row
        const header = cols.map(c => escapeCSV(c.label || c)).join(',');

        // Data rows
        const rows = data.map(row => {
            return cols.map(c => {
                const key = c.key || c;
                let value = row[key];

                // Handle nested properties
                if (key.includes('.')) {
                    value = key.split('.').reduce((obj, k) => obj?.[k], row);
                }

                // Format value if formatter provided
                if (c.format && typeof c.format === 'function') {
                    value = c.format(value, row);
                }

                return escapeCSV(value);
            }).join(',');
        });

        return [header, ...rows].join('\n');
    }

    // ============ LEAD EXPORTS ============

    exportLeads(leads, options = {}) {
        const columns = [
            { key: 'id', label: 'ID' },
            { key: 'company', label: 'Company' },
            { key: 'name', label: 'Contact Name' },
            { key: 'email', label: 'Email' },
            { key: 'phone', label: 'Phone' },
            { key: 'title', label: 'Title' },
            { key: 'size', label: 'Company Size' },
            { key: 'industry', label: 'Industry' },
            { key: 'status', label: 'Status' },
            { key: 'score', label: 'Score' },
            { key: 'priority', label: 'Priority' },
            { key: 'tier', label: 'Recommended Tier' },
            { key: 'source', label: 'Source' },
            { key: 'createdAt', label: 'Created', format: v => v?.split('T')[0] }
        ];

        if (options.format === 'json') {
            return JSON.stringify(leads, null, 2);
        }

        return this.toCSV(leads, columns);
    }

    // ============ DEAL EXPORTS ============

    exportDeals(deals, options = {}) {
        const columns = [
            { key: 'id', label: 'ID' },
            { key: 'company', label: 'Company' },
            { key: 'contactName', label: 'Contact' },
            { key: 'contactEmail', label: 'Email' },
            { key: 'tier', label: 'Tier' },
            { key: 'tierName', label: 'Plan' },
            { key: 'seats', label: 'Seats' },
            { key: 'amount', label: 'Original Amount', format: v => (v / 100).toFixed(2) },
            { key: 'discount', label: 'Discount %' },
            { key: 'finalAmount', label: 'Final Amount', format: v => (v / 100).toFixed(2) },
            { key: 'status', label: 'Status' },
            { key: 'probability', label: 'Probability %' },
            { key: 'expectedCloseDate', label: 'Expected Close' },
            { key: 'createdAt', label: 'Created', format: v => v?.split('T')[0] }
        ];

        if (options.format === 'json') {
            return JSON.stringify(deals, null, 2);
        }

        return this.toCSV(deals, columns);
    }

    // ============ PROPOSAL EXPORTS ============

    exportProposals(proposals, options = {}) {
        const columns = [
            { key: 'id', label: 'ID' },
            { key: 'proposalNumber', label: 'Proposal #' },
            { key: 'company', label: 'Company' },
            { key: 'contactName', label: 'Contact' },
            { key: 'contactEmail', label: 'Email' },
            { key: 'tierName', label: 'Plan' },
            { key: 'seats', label: 'Seats' },
            { key: 'originalPrice', label: 'Original Price', format: v => (v / 100).toFixed(2) },
            { key: 'discount', label: 'Discount %' },
            { key: 'finalPrice', label: 'Final Price', format: v => (v / 100).toFixed(2) },
            { key: 'status', label: 'Status' },
            { key: 'validUntil', label: 'Valid Until' },
            { key: 'viewCount', label: 'Views' },
            { key: 'createdAt', label: 'Created', format: v => v?.split('T')[0] }
        ];

        if (options.format === 'json') {
            return JSON.stringify(proposals, null, 2);
        }

        return this.toCSV(proposals, columns);
    }

    // ============ USER EXPORTS ============

    exportUsers(users, options = {}) {
        const columns = [
            { key: 'id', label: 'ID' },
            { key: 'name', label: 'Name' },
            { key: 'email', label: 'Email' },
            { key: 'plan', label: 'Plan' },
            { key: 'status', label: 'Status' },
            { key: 'storageUsed', label: 'Storage Used (MB)' },
            { key: 'storageLimit', label: 'Storage Limit (MB)' },
            { key: 'source', label: 'Source' },
            { key: 'joined', label: 'Joined', format: v => v?.split('T')[0] }
        ];

        if (options.format === 'json') {
            return JSON.stringify(users, null, 2);
        }

        return this.toCSV(users, columns);
    }

    // ============ AFFILIATE EXPORTS ============

    exportAffiliates(affiliates, options = {}) {
        const columns = [
            { key: 'id', label: 'ID' },
            { key: 'name', label: 'Name' },
            { key: 'email', label: 'Email' },
            { key: 'company', label: 'Company' },
            { key: 'code', label: 'Referral Code' },
            { key: 'type', label: 'Type' },
            { key: 'tier', label: 'Tier' },
            { key: 'commissionRate', label: 'Commission %' },
            { key: 'stats.clicks', label: 'Clicks' },
            { key: 'stats.leads', label: 'Leads' },
            { key: 'stats.conversions', label: 'Conversions' },
            { key: 'stats.revenue', label: 'Revenue', format: v => (v / 100).toFixed(2) },
            { key: 'stats.commission', label: 'Commission', format: v => (v / 100).toFixed(2) },
            { key: 'status', label: 'Status' },
            { key: 'createdAt', label: 'Created', format: v => v?.split('T')[0] }
        ];

        if (options.format === 'json') {
            return JSON.stringify(affiliates, null, 2);
        }

        return this.toCSV(affiliates, columns);
    }

    // ============ DEMO EXPORTS ============

    exportDemos(demos, options = {}) {
        const columns = [
            { key: 'id', label: 'ID' },
            { key: 'company', label: 'Company' },
            { key: 'contactName', label: 'Contact' },
            { key: 'contactEmail', label: 'Email' },
            { key: 'date', label: 'Date' },
            { key: 'time', label: 'Time' },
            { key: 'duration', label: 'Duration (min)' },
            { key: 'status', label: 'Status' },
            { key: 'tier', label: 'Interested Tier' },
            { key: 'meetingLink', label: 'Meeting Link' },
            { key: 'notes', label: 'Notes' },
            { key: 'createdAt', label: 'Created', format: v => v?.split('T')[0] }
        ];

        if (options.format === 'json') {
            return JSON.stringify(demos, null, 2);
        }

        return this.toCSV(demos, columns);
    }

    // ============ ACTIVITY EXPORTS ============

    exportActivities(activities, options = {}) {
        const columns = [
            { key: 'id', label: 'ID' },
            { key: 'timestamp', label: 'Timestamp' },
            { key: 'type', label: 'Type' },
            { key: 'category', label: 'Category' },
            { key: 'action', label: 'Action' },
            { key: 'description', label: 'Description' },
            { key: 'entityType', label: 'Entity Type' },
            { key: 'entityId', label: 'Entity ID' },
            { key: 'entityName', label: 'Entity Name' },
            { key: 'userName', label: 'User' }
        ];

        if (options.format === 'json') {
            return JSON.stringify(activities, null, 2);
        }

        return this.toCSV(activities, columns);
    }

    // ============ TRANSACTION EXPORTS ============

    exportTransactions(transactions, options = {}) {
        const columns = [
            { key: 'id', label: 'ID' },
            { key: 'userId', label: 'User ID' },
            { key: 'type', label: 'Type' },
            { key: 'amount', label: 'Amount', format: v => (v / 100).toFixed(2) },
            { key: 'currency', label: 'Currency' },
            { key: 'status', label: 'Status' },
            { key: 'planId', label: 'Plan' },
            { key: 'paymentId', label: 'Payment ID' },
            { key: 'createdAt', label: 'Date', format: v => v?.split('T')[0] }
        ];

        if (options.format === 'json') {
            return JSON.stringify(transactions, null, 2);
        }

        return this.toCSV(transactions, columns);
    }

    // ============ REPORT GENERATION ============

    generateSalesReport(data) {
        const { leads, deals, proposals, affiliates, period } = data;

        const report = {
            title: 'DOZ UP Sales Report',
            generatedAt: new Date().toISOString(),
            period,

            summary: {
                totalLeads: leads.length,
                qualifiedLeads: leads.filter(l => l.status === 'qualified').length,
                hotLeads: leads.filter(l => l.priority === 'hot').length,

                totalDeals: deals.length,
                wonDeals: deals.filter(d => d.status === 'won').length,
                lostDeals: deals.filter(d => d.status === 'lost').length,
                pipelineDeals: deals.filter(d => !['won', 'lost'].includes(d.status)).length,

                totalProposals: proposals.length,
                acceptedProposals: proposals.filter(p => p.status === 'accepted').length,
                pendingProposals: proposals.filter(p => ['sent', 'viewed'].includes(p.status)).length,

                revenue: {
                    won: deals.filter(d => d.status === 'won').reduce((sum, d) => sum + d.finalAmount, 0) / 100,
                    pipeline: deals.filter(d => !['won', 'lost'].includes(d.status))
                        .reduce((sum, d) => sum + (d.finalAmount * d.probability / 100), 0) / 100
                },

                affiliates: {
                    total: affiliates.length,
                    revenue: affiliates.reduce((sum, a) => sum + a.stats.revenue, 0) / 100,
                    conversions: affiliates.reduce((sum, a) => sum + a.stats.conversions, 0)
                }
            },

            conversionMetrics: {
                leadToQualified: leads.length > 0
                    ? ((leads.filter(l => l.status === 'qualified').length / leads.length) * 100).toFixed(1) + '%'
                    : '0%',
                leadToDeal: leads.length > 0
                    ? ((deals.length / leads.length) * 100).toFixed(1) + '%'
                    : '0%',
                dealWinRate: deals.length > 0
                    ? ((deals.filter(d => d.status === 'won').length / deals.length) * 100).toFixed(1) + '%'
                    : '0%',
                proposalAcceptRate: proposals.length > 0
                    ? ((proposals.filter(p => p.status === 'accepted').length / proposals.length) * 100).toFixed(1) + '%'
                    : '0%'
            },

            topDeals: deals
                .filter(d => d.status === 'won')
                .sort((a, b) => b.finalAmount - a.finalAmount)
                .slice(0, 5)
                .map(d => ({
                    company: d.company,
                    amount: d.finalAmount / 100,
                    tier: d.tierName
                })),

            topAffiliates: affiliates
                .sort((a, b) => b.stats.revenue - a.stats.revenue)
                .slice(0, 5)
                .map(a => ({
                    name: a.name,
                    revenue: a.stats.revenue / 100,
                    conversions: a.stats.conversions
                }))
        };

        return report;
    }

    // ============ FILE EXPORT ============

    async exportToFile(data, filename, format = 'csv') {
        const exportId = uuidv4();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fullFilename = `${filename}_${timestamp}.${format}`;
        const filepath = path.join(exportDir, fullFilename);

        let content;
        let contentType;

        if (format === 'json') {
            content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
            contentType = 'application/json';
        } else if (format === 'csv') {
            content = data;
            contentType = 'text/csv';
        } else {
            throw new Error('Unsupported format');
        }

        fs.writeFileSync(filepath, content);

        return {
            id: exportId,
            filename: fullFilename,
            filepath,
            format,
            contentType,
            size: content.length,
            createdAt: new Date().toISOString()
        };
    }

    // Download exported file
    downloadExport(filename) {
        const filepath = path.join(exportDir, filename);
        if (!fs.existsSync(filepath)) {
            throw new Error('Export file not found');
        }

        const ext = path.extname(filename).toLowerCase();
        const contentType = ext === '.json' ? 'application/json' : 'text/csv';

        return {
            filename,
            data: fs.readFileSync(filepath),
            contentType
        };
    }

    // List exports
    listExports() {
        const files = fs.readdirSync(exportDir);
        return files
            .filter(f => f.endsWith('.csv') || f.endsWith('.json'))
            .map(f => {
                const filepath = path.join(exportDir, f);
                const stats = fs.statSync(filepath);
                return {
                    filename: f,
                    size: stats.size,
                    createdAt: stats.birthtime.toISOString()
                };
            })
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    // Cleanup old exports (older than 24 hours)
    cleanupOldExports() {
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        const files = fs.readdirSync(exportDir);
        let cleaned = 0;

        for (const file of files) {
            const filepath = path.join(exportDir, file);
            const stats = fs.statSync(filepath);
            if (stats.birthtime.getTime() < oneDayAgo) {
                fs.unlinkSync(filepath);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            console.log(`[Export] Cleaned ${cleaned} old export files`);
        }
    }
}

module.exports = new ExportService();
