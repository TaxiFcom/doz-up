/**
 * DOZ UP - Outreach & Email System
 * Email templates and sequences for sales outreach
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Try to load the email queue for sending
let emailQueue = null;
try {
    const { emailQueue: queue } = require('../infrastructure/jobs/queues');
    emailQueue = queue;
    console.log('[Outreach] Email queue connected');
} catch (err) {
    console.warn('[Outreach] Email queue not available - emails will be logged only');
}

const dataDir = path.join(__dirname, '..', 'data');
const outreachPath = path.join(dataDir, 'outreach.json');
const sequencesPath = path.join(dataDir, 'sequences.json');

// Ensure data directory
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

// ============ EMAIL TEMPLATES ============
const EMAIL_TEMPLATES = {
    // Cold Outreach Sequence
    cold_intro: {
        id: 'cold_intro',
        name: 'Cold Introduction',
        subject: '{{company}} + DOZ UP: Save 10+ hours/week on screenshots',
        body: `Hi {{firstName}},

I noticed {{company}} is growing fast - congrats on the recent {{trigger}}!

Quick question: How much time does your team spend capturing, uploading, and sharing screenshots for bug reports, documentation, or client communication?

Most teams we talk to spend 30+ minutes per person per day on this. DOZ UP cuts that to under 5 minutes.

**One hotkey (Ctrl+Shift+S) → instant capture → auto-upload → shareable link copied.**

We're offering founding customer pricing this week only - 40% off annual plans.

Worth a quick 15-min demo?

Best,
{{senderName}}

P.S. {{personalization}}`,
        variables: ['firstName', 'company', 'trigger', 'senderName', 'personalization']
    },

    cold_followup_1: {
        id: 'cold_followup_1',
        name: 'Follow-up #1 (Value)',
        subject: 'Re: {{company}} + DOZ UP',
        body: `Hi {{firstName}},

Following up on my note about DOZ UP.

Just wanted to share a quick stat: Our customers report saving an average of **10.5 hours per week** per team after switching.

For a team of {{teamSize}}, that's {{hoursSaved}} hours/week back - or roughly {{dollarsSaved}}/year in productivity gains.

Our enterprise plan is currently {{price}}/year (40% off this week).

ROI positive in the first month.

Would tomorrow or Thursday work for a quick demo?

Best,
{{senderName}}`,
        variables: ['firstName', 'company', 'teamSize', 'hoursSaved', 'dollarsSaved', 'price', 'senderName']
    },

    cold_followup_2: {
        id: 'cold_followup_2',
        name: 'Follow-up #2 (Social Proof)',
        subject: 'How {{similarCompany}} saved 15 hours/week',
        body: `Hi {{firstName}},

Thought you might find this interesting:

{{similarCompany}} (similar size to {{company}}) switched to DOZ UP 3 months ago. Results:

• 15 hours/week saved across their engineering team
• Bug report time reduced from 5 min to 30 seconds
• 100% adoption within first week

"DOZ UP transformed how we communicate visually. Can't imagine going back." - {{testimonialAuthor}}, {{testimonialRole}}

I have 2 demo slots left this week. Want one?

Best,
{{senderName}}`,
        variables: ['firstName', 'company', 'similarCompany', 'testimonialAuthor', 'testimonialRole', 'senderName']
    },

    cold_followup_3: {
        id: 'cold_followup_3',
        name: 'Follow-up #3 (Urgency)',
        subject: '48 hours left: {{company}} founding customer spot',
        body: `Hi {{firstName}},

Quick heads up - our launch pricing ends in 48 hours.

After Friday:
• Prices go up 40%
• Founding customer benefits expire
• No more lifetime price lock

I'd hate for {{company}} to miss this window.

If timing isn't right, no worries at all. But if there's any interest, now's the moment.

15 minutes - that's all I need to show you why 500+ companies made the switch.

Calendar link: {{calendarLink}}

Best,
{{senderName}}`,
        variables: ['firstName', 'company', 'calendarLink', 'senderName']
    },

    cold_breakup: {
        id: 'cold_breakup',
        name: 'Break-up Email',
        subject: 'Closing your file, {{firstName}}',
        body: `Hi {{firstName}},

I've reached out a few times about DOZ UP but haven't heard back.

I'm going to assume the timing isn't right and close your file for now.

If things change in the future, feel free to reach out. Our door is always open.

In the meantime, here's a free resource that might help regardless: "10 Ways to Speed Up Your Team's Visual Communication" - {{resourceLink}}

All the best to you and the {{company}} team.

Cheers,
{{senderName}}`,
        variables: ['firstName', 'company', 'resourceLink', 'senderName']
    },

    // Demo Follow-ups
    demo_confirmation: {
        id: 'demo_confirmation',
        name: 'Demo Confirmation',
        subject: 'Confirmed: DOZ UP Demo - {{date}} at {{time}}',
        body: `Hi {{firstName}},

Great chatting! Looking forward to our demo.

**Details:**
📅 {{date}} at {{time}} {{timezone}}
📍 {{meetingLink}}
⏱️ 30 minutes

**What we'll cover:**
1. Quick overview of DOZ UP (5 min)
2. Live demo tailored to {{company}}'s needs (15 min)
3. Q&A and next steps (10 min)

**Before the call, it'd help to know:**
- How many people would use this? (rough estimate)
- What tools do you currently use for screenshots?
- Any specific pain points?

Feel free to reply with answers or we can discuss live.

See you {{day}}!

{{senderName}}`,
        variables: ['firstName', 'company', 'date', 'time', 'timezone', 'meetingLink', 'day', 'senderName']
    },

    demo_reminder: {
        id: 'demo_reminder',
        name: 'Demo Reminder (1 hour)',
        subject: 'Starting in 1 hour: DOZ UP Demo',
        body: `Hi {{firstName}},

Quick reminder - we're meeting in 1 hour!

📍 Join here: {{meetingLink}}

See you soon,
{{senderName}}`,
        variables: ['firstName', 'meetingLink', 'senderName']
    },

    post_demo: {
        id: 'post_demo',
        name: 'Post-Demo Follow-up',
        subject: 'Next steps for {{company}} + DOZ UP',
        body: `Hi {{firstName}},

Thanks for taking the time today! Great conversation.

As promised, here's a summary:

**What we discussed:**
{{discussionSummary}}

**Recommended plan:** {{recommendedPlan}}
**Launch pricing:** {{price}} (40% off, expires {{expiryDate}})
**Team size:** {{teamSize}} seats

**Next steps:**
{{nextSteps}}

I've attached a proposal with full details. Happy to answer any questions.

If you're ready to move forward, here's the signup link: {{signupLink}}

Talk soon,
{{senderName}}`,
        variables: ['firstName', 'company', 'discussionSummary', 'recommendedPlan', 'price', 'expiryDate', 'teamSize', 'nextSteps', 'signupLink', 'senderName']
    },

    // Proposal & Closing
    proposal_sent: {
        id: 'proposal_sent',
        name: 'Proposal Sent',
        subject: 'Your DOZ UP Proposal - {{company}}',
        body: `Hi {{firstName}},

As discussed, please find attached your custom proposal for DOZ UP Enterprise.

**Proposal Summary:**
• Plan: {{planName}}
• Seats: {{seats}}
• Annual Investment: {{price}}
• Savings vs. standard pricing: {{savings}}

**What's included:**
{{features}}

**Founding Customer Bonuses (expires {{expiryDate}}):**
✓ Lifetime price lock
✓ Priority onboarding
✓ Dedicated success manager
✓ Early access to new features

To proceed, simply reply "approved" or click here: {{approvalLink}}

Questions? I'm here to help.

Best,
{{senderName}}`,
        variables: ['firstName', 'company', 'planName', 'seats', 'price', 'savings', 'features', 'expiryDate', 'approvalLink', 'senderName']
    },

    proposal_followup: {
        id: 'proposal_followup',
        name: 'Proposal Follow-up',
        subject: 'Quick check-in: {{company}} proposal',
        body: `Hi {{firstName}},

Just checking in on the proposal I sent {{daysSent}} days ago.

Any questions I can answer? Happy to hop on a quick call if that's easier.

Reminder: Launch pricing expires {{expiryDate}} - wanted to make sure {{company}} doesn't miss the window.

Best,
{{senderName}}`,
        variables: ['firstName', 'company', 'daysSent', 'expiryDate', 'senderName']
    },

    deal_won: {
        id: 'deal_won',
        name: 'Welcome - Deal Won',
        subject: 'Welcome to DOZ UP, {{company}}! 🎉',
        body: `Hi {{firstName}},

HUGE welcome to the DOZ UP family! 🎉

We're thrilled to have {{company}} on board.

**Your account details:**
• Plan: {{planName}}
• Seats: {{seats}}
• Account ID: {{accountId}}

**Next steps:**
1. Download the desktop app: {{downloadLink}}
2. Invite your team: {{inviteLink}}
3. Schedule onboarding call: {{onboardingLink}}

Your dedicated success manager is {{csmName}} (cc'd). They'll reach out within 24 hours to ensure a smooth rollout.

Welcome aboard!

{{senderName}}

P.S. As a founding customer, you're locked in at this rate forever. Thanks for believing in us early!`,
        variables: ['firstName', 'company', 'planName', 'seats', 'accountId', 'downloadLink', 'inviteLink', 'onboardingLink', 'csmName', 'senderName']
    }
};

// ============ EMAIL SEQUENCES ============
const SEQUENCES = {
    cold_outreach: {
        id: 'cold_outreach',
        name: 'Cold Outreach Sequence',
        description: '5-touch cold email sequence',
        steps: [
            { day: 0, templateId: 'cold_intro', action: 'send' },
            { day: 2, templateId: 'cold_followup_1', action: 'send', condition: 'no_reply' },
            { day: 4, templateId: 'cold_followup_2', action: 'send', condition: 'no_reply' },
            { day: 6, templateId: 'cold_followup_3', action: 'send', condition: 'no_reply' },
            { day: 10, templateId: 'cold_breakup', action: 'send', condition: 'no_reply' }
        ]
    },
    demo_sequence: {
        id: 'demo_sequence',
        name: 'Demo Sequence',
        description: 'Pre and post demo emails',
        steps: [
            { day: 0, templateId: 'demo_confirmation', action: 'send', trigger: 'demo_scheduled' },
            { day: 0, templateId: 'demo_reminder', action: 'send', trigger: '1_hour_before' },
            { day: 0, templateId: 'post_demo', action: 'send', trigger: 'demo_completed' }
        ]
    },
    proposal_sequence: {
        id: 'proposal_sequence',
        name: 'Proposal Sequence',
        description: 'Proposal follow-up sequence',
        steps: [
            { day: 0, templateId: 'proposal_sent', action: 'send', trigger: 'proposal_created' },
            { day: 2, templateId: 'proposal_followup', action: 'send', condition: 'no_response' },
            { day: 4, templateId: 'proposal_followup', action: 'send', condition: 'no_response' }
        ]
    }
};

class OutreachService {
    constructor() {
        this.outreach = loadJSON(outreachPath, { campaigns: [], emails: [] });
    }

    // Get all templates
    getTemplates() {
        return EMAIL_TEMPLATES;
    }

    // Get template by ID
    getTemplate(templateId) {
        return EMAIL_TEMPLATES[templateId] || null;
    }

    // Get all sequences
    getSequences() {
        return SEQUENCES;
    }

    // Render template with variables
    renderTemplate(templateId, variables = {}) {
        const template = this.getTemplate(templateId);
        if (!template) return null;

        let subject = template.subject;
        let body = template.body;

        // Replace variables
        for (const [key, value] of Object.entries(variables)) {
            const regex = new RegExp(`{{${key}}}`, 'g');
            subject = subject.replace(regex, value || '');
            body = body.replace(regex, value || '');
        }

        return {
            templateId,
            subject,
            body,
            renderedAt: new Date().toISOString()
        };
    }

    // Create email campaign
    createCampaign(data) {
        const campaign = {
            id: uuidv4(),
            name: data.name,
            sequenceId: data.sequenceId,
            status: 'draft', // draft, active, paused, completed
            recipients: data.recipients || [],
            stats: {
                sent: 0,
                opened: 0,
                clicked: 0,
                replied: 0,
                bounced: 0
            },
            createdAt: new Date().toISOString(),
            startedAt: null
        };

        this.outreach.campaigns.push(campaign);
        saveJSON(outreachPath, this.outreach);

        return campaign;
    }

    // Log email sent
    logEmail(data) {
        const email = {
            id: uuidv4(),
            campaignId: data.campaignId || null,
            templateId: data.templateId,
            leadId: data.leadId,
            to: data.to,
            subject: data.subject,
            status: 'sent',
            sentAt: new Date().toISOString(),
            openedAt: null,
            clickedAt: null,
            repliedAt: null
        };

        this.outreach.emails.push(email);
        saveJSON(outreachPath, this.outreach);

        return email;
    }

    // Get campaign stats
    getCampaignStats(campaignId) {
        const campaign = this.outreach.campaigns.find(c => c.id === campaignId);
        if (!campaign) return null;

        const emails = this.outreach.emails.filter(e => e.campaignId === campaignId);

        return {
            ...campaign,
            emailCount: emails.length,
            openRate: emails.length > 0
                ? ((emails.filter(e => e.openedAt).length / emails.length) * 100).toFixed(1)
                : 0,
            replyRate: emails.length > 0
                ? ((emails.filter(e => e.repliedAt).length / emails.length) * 100).toFixed(1)
                : 0
        };
    }

    // Generate personalized email for lead
    generateEmailForLead(lead, templateId, additionalVars = {}) {
        const firstName = lead.name?.split(' ')[0] || 'there';
        const teamSize = this.estimateTeamSize(lead.size);
        const hoursSaved = teamSize * 10.5;
        const dollarsSaved = Math.round(hoursSaved * 52 * 50); // $50/hour

        const variables = {
            firstName,
            company: lead.company,
            teamSize,
            hoursSaved: hoursSaved.toFixed(1),
            dollarsSaved: '$' + dollarsSaved.toLocaleString(),
            senderName: 'The DOZ UP Team',
            calendarLink: 'https://calendly.com/dozup/demo',
            trigger: 'growth',
            personalization: `I saw you're hiring for engineering roles - visual communication tools become critical as teams scale.`,
            ...additionalVars
        };

        return this.renderTemplate(templateId, variables);
    }

    estimateTeamSize(sizeCategory) {
        const sizes = {
            '1-10': 5,
            '11-50': 30,
            '51-200': 100,
            '201-500': 300,
            '500+': 500
        };
        return sizes[sizeCategory] || 50;
    }

    // Send email to lead using email queue
    async sendEmail(leadId, templateId, to, variables = {}, campaignId = null) {
        // Render the template
        const rendered = this.renderTemplate(templateId, variables);
        if (!rendered) {
            throw new Error(`Template ${templateId} not found`);
        }

        // Convert markdown-style body to HTML
        const htmlBody = this.markdownToHtml(rendered.body);

        // Queue the email
        if (emailQueue) {
            await emailQueue.add('email', {
                to: to,
                subject: rendered.subject,
                html: htmlBody,
                template: templateId,
                metadata: { leadId, campaignId }
            });
            console.log(`[Outreach] Email queued to ${to}: ${rendered.subject}`);
        } else {
            console.log(`[Outreach] DEV MODE - Would send to ${to}: ${rendered.subject}`);
        }

        // Log the email
        return this.logEmail({
            leadId,
            campaignId,
            templateId,
            to,
            subject: rendered.subject
        });
    }

    // Simple markdown to HTML conversion
    markdownToHtml(text) {
        return text
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')  // Bold
            .replace(/\*(.+?)\*/g, '<em>$1</em>')              // Italic
            .replace(/^• /gm, '<li>')                          // Bullets
            .replace(/^✓ /gm, '<li>✓ ')                        // Checkmarks
            .replace(/\n\n/g, '</p><p>')                       // Paragraphs
            .replace(/\n/g, '<br>')                            // Line breaks
            .replace(/^/, '<p>')                               // Start paragraph
            .replace(/$/, '</p>');                             // End paragraph
    }

    // Send campaign to all recipients
    async runCampaign(campaignId) {
        const campaign = this.outreach.campaigns.find(c => c.id === campaignId);
        if (!campaign) {
            throw new Error('Campaign not found');
        }

        const sequence = SEQUENCES[campaign.sequenceId];
        if (!sequence) {
            throw new Error('Sequence not found');
        }

        campaign.status = 'active';
        campaign.startedAt = new Date().toISOString();

        // Send first step to all recipients
        const firstStep = sequence.steps[0];
        for (const recipient of campaign.recipients) {
            try {
                await this.sendEmail(
                    recipient.leadId,
                    firstStep.templateId,
                    recipient.email,
                    recipient.variables || {},
                    campaignId
                );
                campaign.stats.sent++;
            } catch (err) {
                console.error(`[Outreach] Failed to send to ${recipient.email}:`, err.message);
            }
        }

        saveJSON(outreachPath, this.outreach);
        return campaign;
    }

    // Get outreach stats
    getStats() {
        const campaigns = this.outreach.campaigns;
        const emails = this.outreach.emails;

        const totalSent = emails.length;
        const totalOpened = emails.filter(e => e.openedAt).length;
        const totalReplied = emails.filter(e => e.repliedAt).length;

        return {
            campaigns: {
                total: campaigns.length,
                active: campaigns.filter(c => c.status === 'active').length,
                completed: campaigns.filter(c => c.status === 'completed').length
            },
            emails: {
                total: totalSent,
                opened: totalOpened,
                replied: totalReplied,
                openRate: totalSent > 0 ? ((totalOpened / totalSent) * 100).toFixed(1) : 0,
                replyRate: totalSent > 0 ? ((totalReplied / totalSent) * 100).toFixed(1) : 0
            }
        };
    }
}

module.exports = new OutreachService();
module.exports.EMAIL_TEMPLATES = EMAIL_TEMPLATES;
module.exports.SEQUENCES = SEQUENCES;
