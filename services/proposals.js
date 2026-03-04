/**
 * DOZ UP - Proposal Generator
 * Generate professional proposals for enterprise deals
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { ENTERPRISE_TIERS } = require('./enterprise');

const dataDir = path.join(__dirname, '..', 'data');
const proposalsPath = path.join(dataDir, 'proposals.json');

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

function loadJSON(filepath, defaultValue = []) {
    try {
        if (fs.existsSync(filepath)) {
            return JSON.parse(fs.readFileSync(filepath, 'utf8'));
        }
    } catch (e) {}
    return defaultValue;
}

function saveJSON(filepath, data) {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

class ProposalService {
    constructor() {
        this.proposals = loadJSON(proposalsPath, []);
    }

    // Create proposal
    createProposal(data) {
        const tier = ENTERPRISE_TIERS[data.tier] || ENTERPRISE_TIERS.business;
        const originalPrice = Math.round(tier.price * 1.67); // 40% discount means original is 1.67x
        const discount = data.discount || 40;
        const discountedPrice = Math.round(tier.price * (1 - (discount - 40) / 100)); // Additional discount

        const proposal = {
            id: uuidv4(),
            proposalNumber: `DOZ-${Date.now().toString().slice(-6)}`,
            leadId: data.leadId,
            dealId: data.dealId || null,

            // Company info
            company: data.company,
            contactName: data.contactName,
            contactEmail: data.contactEmail,
            contactTitle: data.contactTitle || '',

            // Plan details
            tier: data.tier,
            tierName: tier.name,
            seats: data.seats || tier.seats,
            storage: tier.storage,

            // Pricing
            originalPrice,
            discount,
            finalPrice: discountedPrice,
            savings: originalPrice - discountedPrice,
            term: data.term || 12, // months
            paymentTerms: data.paymentTerms || 'annual', // annual, quarterly, monthly

            // Features
            features: tier.features,
            customFeatures: data.customFeatures || [],

            // Bonuses
            bonuses: [
                'Lifetime price lock at founding customer rate',
                'Priority onboarding and setup assistance',
                'Dedicated customer success manager',
                'Early access to new features',
                'Extended 30-day money-back guarantee'
            ],

            // Validity
            validUntil: this.getValidUntilDate(data.validDays || 5),
            expiresIn: data.validDays || 5,

            // Status
            status: 'draft', // draft, sent, viewed, accepted, declined, expired
            sentAt: null,
            viewedAt: null,
            respondedAt: null,

            // Notes
            notes: data.notes || '',
            internalNotes: data.internalNotes || '',

            // Tracking
            viewCount: 0,
            lastViewedAt: null,

            createdAt: new Date().toISOString(),
            createdBy: data.createdBy || 'system'
        };

        this.proposals.push(proposal);
        saveJSON(proposalsPath, this.proposals);

        return proposal;
    }

    getValidUntilDate(days) {
        const date = new Date();
        date.setDate(date.getDate() + days);
        return date.toISOString().split('T')[0];
    }

    // Get proposal by ID
    getProposal(proposalId) {
        return this.proposals.find(p => p.id === proposalId);
    }

    // Get proposal by number
    getProposalByNumber(proposalNumber) {
        return this.proposals.find(p => p.proposalNumber === proposalNumber);
    }

    // Get proposals with filters
    getProposals(filters = {}) {
        let proposals = [...this.proposals];

        if (filters.status) {
            proposals = proposals.filter(p => p.status === filters.status);
        }
        if (filters.leadId) {
            proposals = proposals.filter(p => p.leadId === filters.leadId);
        }
        if (filters.company) {
            proposals = proposals.filter(p =>
                p.company.toLowerCase().includes(filters.company.toLowerCase())
            );
        }

        // Sort by created date
        proposals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        return proposals;
    }

    // Update proposal
    updateProposal(proposalId, updates) {
        const proposal = this.proposals.find(p => p.id === proposalId);
        if (!proposal) return null;

        Object.assign(proposal, updates, { updatedAt: new Date().toISOString() });
        saveJSON(proposalsPath, this.proposals);

        return proposal;
    }

    // Mark as sent
    sendProposal(proposalId) {
        return this.updateProposal(proposalId, {
            status: 'sent',
            sentAt: new Date().toISOString()
        });
    }

    // Track view
    trackView(proposalId) {
        const proposal = this.proposals.find(p => p.id === proposalId);
        if (!proposal) return null;

        proposal.viewCount++;
        proposal.lastViewedAt = new Date().toISOString();

        if (proposal.status === 'sent') {
            proposal.status = 'viewed';
            proposal.viewedAt = new Date().toISOString();
        }

        saveJSON(proposalsPath, this.proposals);
        return proposal;
    }

    // Accept proposal
    acceptProposal(proposalId, acceptedBy = '') {
        return this.updateProposal(proposalId, {
            status: 'accepted',
            respondedAt: new Date().toISOString(),
            acceptedBy
        });
    }

    // Decline proposal
    declineProposal(proposalId, reason = '') {
        return this.updateProposal(proposalId, {
            status: 'declined',
            respondedAt: new Date().toISOString(),
            declineReason: reason
        });
    }

    // Generate HTML proposal
    generateHTML(proposalId) {
        const proposal = this.getProposal(proposalId);
        if (!proposal) return null;

        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>DOZ UP Proposal - ${proposal.company}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 800px; margin: 0 auto; padding: 40px; }
        .header { text-align: center; margin-bottom: 40px; border-bottom: 3px solid #4CAF50; padding-bottom: 30px; }
        .logo { font-size: 32px; font-weight: bold; color: #4CAF50; }
        .proposal-number { color: #666; margin-top: 10px; }
        .section { margin-bottom: 30px; }
        .section-title { font-size: 18px; font-weight: 600; color: #4CAF50; margin-bottom: 15px; border-bottom: 1px solid #eee; padding-bottom: 8px; }
        .company-info { background: #f9f9f9; padding: 20px; border-radius: 8px; }
        .pricing-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .pricing-table th, .pricing-table td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
        .pricing-table th { background: #f5f5f5; }
        .total-row { font-size: 20px; font-weight: bold; background: #e8f5e9 !important; }
        .savings { color: #4CAF50; font-weight: 600; }
        .features-list { list-style: none; }
        .features-list li { padding: 8px 0; padding-left: 28px; position: relative; }
        .features-list li:before { content: "✓"; color: #4CAF50; position: absolute; left: 0; font-weight: bold; }
        .bonuses { background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%); padding: 20px; border-radius: 8px; margin: 20px 0; }
        .cta { text-align: center; margin: 40px 0; padding: 30px; background: #4CAF50; border-radius: 8px; }
        .cta-button { display: inline-block; background: white; color: #4CAF50; padding: 15px 40px; font-size: 18px; font-weight: bold; text-decoration: none; border-radius: 6px; }
        .validity { text-align: center; color: #f44336; font-weight: 600; margin: 20px 0; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">DOZ UP</div>
            <div>Enterprise Screenshot Platform</div>
            <div class="proposal-number">Proposal #${proposal.proposalNumber}</div>
        </div>

        <div class="section">
            <div class="section-title">Prepared For</div>
            <div class="company-info">
                <strong>${proposal.company}</strong><br>
                ${proposal.contactName}${proposal.contactTitle ? `, ${proposal.contactTitle}` : ''}<br>
                ${proposal.contactEmail}
            </div>
        </div>

        <div class="section">
            <div class="section-title">Recommended Solution: ${proposal.tierName} Plan</div>
            <table class="pricing-table">
                <tr>
                    <th>Description</th>
                    <th>Details</th>
                    <th>Price</th>
                </tr>
                <tr>
                    <td>DOZ UP ${proposal.tierName}</td>
                    <td>${proposal.seats} seats, ${proposal.storage}GB storage</td>
                    <td><s>$${(proposal.originalPrice / 100).toLocaleString()}</s></td>
                </tr>
                <tr>
                    <td>Launch Discount</td>
                    <td>${proposal.discount}% off (Founding Customer)</td>
                    <td class="savings">-$${(proposal.savings / 100).toLocaleString()}</td>
                </tr>
                <tr class="total-row">
                    <td>Total Annual Investment</td>
                    <td>Billed ${proposal.paymentTerms}</td>
                    <td>$${(proposal.finalPrice / 100).toLocaleString()}/year</td>
                </tr>
            </table>
        </div>

        <div class="section">
            <div class="section-title">What's Included</div>
            <ul class="features-list">
                ${proposal.features.map(f => `<li>${f}</li>`).join('')}
                ${proposal.customFeatures.map(f => `<li><strong>${f}</strong></li>`).join('')}
            </ul>
        </div>

        <div class="bonuses">
            <div class="section-title" style="color: #2E7D32;">Founding Customer Bonuses</div>
            <ul class="features-list">
                ${proposal.bonuses.map(b => `<li>${b}</li>`).join('')}
            </ul>
        </div>

        <div class="validity">
            ⏰ This proposal expires on ${proposal.validUntil}
        </div>

        <div class="cta">
            <div style="color: white; margin-bottom: 15px; font-size: 18px;">Ready to get started?</div>
            <a href="https://doz.com/up/v2/accept/${proposal.id}" class="cta-button">Accept Proposal</a>
        </div>

        <div class="section">
            <div class="section-title">What Happens Next</div>
            <ol style="padding-left: 20px;">
                <li>Accept this proposal by clicking the button above</li>
                <li>Complete payment (invoice will be sent)</li>
                <li>Receive login credentials within 1 hour</li>
                <li>Schedule onboarding call with your success manager</li>
                <li>Start capturing and sharing screenshots!</li>
            </ol>
        </div>

        <div class="footer">
            <p>DOZ Network Corporation | enterprise@doz.com</p>
            <p>Questions? Reply to this email or schedule a call: calendly.com/dozup</p>
        </div>
    </div>
</body>
</html>`;
    }

    // Get proposal stats
    getStats() {
        const proposals = this.proposals;
        const sent = proposals.filter(p => p.status !== 'draft');
        const accepted = proposals.filter(p => p.status === 'accepted');
        const declined = proposals.filter(p => p.status === 'declined');
        const pending = proposals.filter(p => ['sent', 'viewed'].includes(p.status));

        const totalValue = proposals.reduce((sum, p) => sum + p.finalPrice, 0);
        const acceptedValue = accepted.reduce((sum, p) => sum + p.finalPrice, 0);
        const pendingValue = pending.reduce((sum, p) => sum + p.finalPrice, 0);

        return {
            total: proposals.length,
            draft: proposals.filter(p => p.status === 'draft').length,
            sent: sent.length,
            viewed: proposals.filter(p => p.status === 'viewed').length,
            accepted: accepted.length,
            declined: declined.length,
            pending: pending.length,
            expired: proposals.filter(p => p.status === 'expired').length,
            acceptanceRate: sent.length > 0
                ? ((accepted.length / sent.length) * 100).toFixed(1)
                : 0,
            totalValue: totalValue / 100,
            acceptedValue: acceptedValue / 100,
            pendingValue: pendingValue / 100,
            avgProposalValue: proposals.length > 0
                ? (totalValue / proposals.length / 100).toFixed(0)
                : 0
        };
    }

    // Check for expired proposals
    checkExpired() {
        const today = new Date().toISOString().split('T')[0];
        let expiredCount = 0;

        this.proposals.forEach(p => {
            if (['sent', 'viewed'].includes(p.status) && p.validUntil < today) {
                p.status = 'expired';
                expiredCount++;
            }
        });

        if (expiredCount > 0) {
            saveJSON(proposalsPath, this.proposals);
        }

        return expiredCount;
    }
}

module.exports = new ProposalService();
