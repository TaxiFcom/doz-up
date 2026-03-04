/**
 * DOZ UP - Demo Scheduling & Calendar System
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const dataDir = path.join(__dirname, '..', 'data');
const demosPath = path.join(dataDir, 'demos.json');
const slotsPath = path.join(dataDir, 'availability.json');

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

// Default availability (9 AM - 6 PM EST, 30-min slots)
const DEFAULT_AVAILABILITY = {
    timezone: 'America/New_York',
    slotDuration: 30, // minutes
    bufferTime: 15, // minutes between meetings
    workingHours: {
        start: 9, // 9 AM
        end: 18 // 6 PM
    },
    workingDays: [1, 2, 3, 4, 5], // Monday - Friday
    maxDaysAhead: 14
};

class SchedulingService {
    constructor() {
        this.demos = loadJSON(demosPath, []);
        this.availability = loadJSON(slotsPath, DEFAULT_AVAILABILITY);
    }

    // Get available slots for the next N days
    getAvailableSlots(days = 7) {
        const slots = [];
        const now = new Date();
        const { workingHours, workingDays, slotDuration, bufferTime } = this.availability;

        for (let d = 0; d < Math.min(days, this.availability.maxDaysAhead); d++) {
            const date = new Date(now);
            date.setDate(date.getDate() + d);

            // Skip non-working days
            if (!workingDays.includes(date.getDay())) continue;

            const dateStr = date.toISOString().split('T')[0];

            // Get booked slots for this day
            const bookedSlots = this.demos
                .filter(demo => demo.date === dateStr && demo.status !== 'cancelled')
                .map(demo => demo.time);

            // Generate available slots
            for (let hour = workingHours.start; hour < workingHours.end; hour++) {
                for (let min = 0; min < 60; min += slotDuration) {
                    const time = `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;

                    // Check if slot is in the past
                    if (d === 0) {
                        const slotTime = new Date(date);
                        slotTime.setHours(hour, min);
                        if (slotTime <= now) continue;
                    }

                    // Check if slot is booked
                    if (!bookedSlots.includes(time)) {
                        slots.push({
                            date: dateStr,
                            time,
                            datetime: `${dateStr}T${time}:00`,
                            available: true
                        });
                    }
                }
            }
        }

        return slots;
    }

    // Get slots grouped by date
    getSlotsGroupedByDate(days = 7) {
        const slots = this.getAvailableSlots(days);
        const grouped = {};

        for (const slot of slots) {
            if (!grouped[slot.date]) {
                grouped[slot.date] = {
                    date: slot.date,
                    dayName: new Date(slot.date).toLocaleDateString('en-US', { weekday: 'long' }),
                    slots: []
                };
            }
            grouped[slot.date].slots.push({
                time: slot.time,
                datetime: slot.datetime
            });
        }

        return Object.values(grouped);
    }

    // Book a demo
    bookDemo(data) {
        // Validate slot is available
        const availableSlots = this.getAvailableSlots(14);
        const isAvailable = availableSlots.some(
            s => s.date === data.date && s.time === data.time
        );

        if (!isAvailable) {
            throw new Error('This time slot is no longer available');
        }

        const demo = {
            id: uuidv4(),
            leadId: data.leadId,
            company: data.company,
            contactName: data.contactName,
            contactEmail: data.contactEmail,
            contactPhone: data.contactPhone || null,
            date: data.date,
            time: data.time,
            datetime: `${data.date}T${data.time}:00`,
            duration: this.availability.slotDuration,
            timezone: data.timezone || this.availability.timezone,
            meetingLink: this.generateMeetingLink(),
            status: 'scheduled', // scheduled, confirmed, completed, cancelled, no-show
            notes: data.notes || '',
            tier: data.tier || 'business',
            source: data.source || 'website',
            reminders: {
                '24h': false,
                '1h': false
            },
            outcome: null,
            createdAt: new Date().toISOString()
        };

        this.demos.push(demo);
        saveJSON(demosPath, this.demos);

        return demo;
    }

    generateMeetingLink() {
        const meetingId = uuidv4().substring(0, 8);
        return `https://meet.doz.com.im/${meetingId}`;
    }

    // Get demo by ID
    getDemo(demoId) {
        return this.demos.find(d => d.id === demoId);
    }

    // Get demos with filters
    getDemos(filters = {}) {
        let demos = [...this.demos];

        if (filters.status) {
            demos = demos.filter(d => d.status === filters.status);
        }
        if (filters.date) {
            demos = demos.filter(d => d.date === filters.date);
        }
        if (filters.leadId) {
            demos = demos.filter(d => d.leadId === filters.leadId);
        }

        // Sort by datetime
        demos.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

        return demos;
    }

    // Get upcoming demos
    getUpcomingDemos(limit = 10) {
        const now = new Date();
        return this.demos
            .filter(d => new Date(d.datetime) > now && d.status !== 'cancelled')
            .sort((a, b) => new Date(a.datetime) - new Date(b.datetime))
            .slice(0, limit);
    }

    // Get today's demos
    getTodaysDemos() {
        const today = new Date().toISOString().split('T')[0];
        return this.getDemos({ date: today });
    }

    // Update demo
    updateDemo(demoId, updates) {
        const demo = this.demos.find(d => d.id === demoId);
        if (!demo) return null;

        Object.assign(demo, updates, { updatedAt: new Date().toISOString() });
        saveJSON(demosPath, this.demos);

        return demo;
    }

    // Complete demo with outcome
    completeDemo(demoId, outcome) {
        return this.updateDemo(demoId, {
            status: 'completed',
            outcome: {
                interested: outcome.interested,
                nextStep: outcome.nextStep, // proposal, follow-up, not-interested
                notes: outcome.notes,
                proposalTier: outcome.proposalTier,
                estimatedValue: outcome.estimatedValue,
                completedAt: new Date().toISOString()
            }
        });
    }

    // Cancel demo
    cancelDemo(demoId, reason = '') {
        return this.updateDemo(demoId, {
            status: 'cancelled',
            cancelReason: reason,
            cancelledAt: new Date().toISOString()
        });
    }

    // Reschedule demo
    rescheduleDemo(demoId, newDate, newTime) {
        // Check availability
        const availableSlots = this.getAvailableSlots(14);
        const isAvailable = availableSlots.some(
            s => s.date === newDate && s.time === newTime
        );

        if (!isAvailable) {
            throw new Error('This time slot is no longer available');
        }

        return this.updateDemo(demoId, {
            date: newDate,
            time: newTime,
            datetime: `${newDate}T${newTime}:00`,
            rescheduledAt: new Date().toISOString()
        });
    }

    // Get demo statistics
    getStats() {
        const demos = this.demos;
        const now = new Date();
        const thisWeek = new Date(now);
        thisWeek.setDate(thisWeek.getDate() - 7);

        const scheduled = demos.filter(d => d.status === 'scheduled').length;
        const completed = demos.filter(d => d.status === 'completed').length;
        const cancelled = demos.filter(d => d.status === 'cancelled').length;
        const noShow = demos.filter(d => d.status === 'no-show').length;

        const thisWeekDemos = demos.filter(d => new Date(d.createdAt) >= thisWeek);

        // Conversion from demo to proposal
        const withOutcome = demos.filter(d => d.outcome);
        const proposalConversions = withOutcome.filter(d =>
            d.outcome?.nextStep === 'proposal' || d.outcome?.interested
        ).length;

        return {
            total: demos.length,
            scheduled,
            completed,
            cancelled,
            noShow,
            thisWeek: thisWeekDemos.length,
            upcomingCount: this.getUpcomingDemos(100).length,
            todayCount: this.getTodaysDemos().length,
            showRate: completed + noShow > 0
                ? ((completed / (completed + noShow)) * 100).toFixed(1)
                : 100,
            conversionRate: withOutcome.length > 0
                ? ((proposalConversions / withOutcome.length) * 100).toFixed(1)
                : 0
        };
    }

    // Update availability settings
    updateAvailability(settings) {
        this.availability = { ...this.availability, ...settings };
        saveJSON(slotsPath, this.availability);
        return this.availability;
    }

    // Get availability settings
    getAvailability() {
        return this.availability;
    }

    // Get demos needing reminders
    getDemosNeedingReminders() {
        const now = new Date();
        const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const in1h = new Date(now.getTime() + 60 * 60 * 1000);

        return {
            reminder24h: this.demos.filter(d => {
                const demoTime = new Date(d.datetime);
                return d.status === 'scheduled' &&
                    !d.reminders['24h'] &&
                    demoTime <= in24h &&
                    demoTime > now;
            }),
            reminder1h: this.demos.filter(d => {
                const demoTime = new Date(d.datetime);
                return d.status === 'scheduled' &&
                    !d.reminders['1h'] &&
                    demoTime <= in1h &&
                    demoTime > now;
            })
        };
    }
}

module.exports = new SchedulingService();
