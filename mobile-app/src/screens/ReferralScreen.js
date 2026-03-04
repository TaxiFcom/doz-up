import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Share,
  Alert,
  ActivityIndicator,
  Clipboard,
  Animated,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../config';
import AnalyticsService from '../services/AnalyticsService';

const REWARD_PER_REFERRAL = 30; // Days free per referral

export default function ReferralScreen() {
  const navigation = useNavigation();
  const { theme } = useTheme();
  const { user, refreshUser } = useAuth();
  
  const [referralData, setReferralData] = useState({
    referralCode: '',
    referralLink: '',
    totalReferrals: 0,
    successfulReferrals: 0,
    rewardDays: 0,
    referrals: [],
  });
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const scaleAnim = useState(new Animated.Value(1))[0];

  // Load referral data
  const loadReferralData = useCallback(async () => {
    if (!user?.id) return;
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/referral/${user.id}`);
      const data = await response.json();
      
      if (data.success) {
        setReferralData(data);
      }
    } catch (error) {
      console.error('Referral data error:', error);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadReferralData();
    }, [loadReferralData])
  );

  // Copy referral code
  const copyCode = () => {
    Clipboard.setString(referralData.referralCode);
    setCopied(true);
    
    // Animate
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 1.1, duration: 100, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();
    
    setTimeout(() => setCopied(false), 2000);
    
    AnalyticsService.logEvent('referral_code_copied');
  };

  // Share referral link
  const shareLink = async () => {
    try {
      const result = await Share.share({
        message: `Join me on DOZ UP - the best screenshot tool! 🚀\n\nGet ${REWARD_PER_REFERRAL} days free when you sign up with my code: ${referralData.referralCode}\n\n${referralData.referralLink}`,
        title: 'DOZ UP - Professional Screenshot Tool',
      });

      if (result.action === Share.sharedAction) {
        AnalyticsService.logEvent('referral_shared', {
          method: result.activityType || 'unknown',
        });
      }
    } catch (error) {
      console.error('Share error:', error);
    }
  };

  // Share via specific app
  const shareVia = (platform) => {
    const messages = {
      whatsapp: `Hey! 👋\n\nCheck out DOZ UP - it's the best screenshot tool I've ever used! 📸\n\nUse my code *${referralData.referralCode}* and get *${REWARD_PER_REFERRAL} days FREE*!\n\n${referralData.referralLink}`,
      telegram: `🚀 DOZ UP - Professional Screenshot Tool\n\nJoin me and get ${REWARD_PER_REFERRAL} days FREE with my code: ${referralData.referralCode}\n\n${referralData.referralLink}`,
      twitter: `Just discovered DOZ UP - the ultimate screenshot tool! 🎯\n\nUse my code ${referralData.referralCode} for ${REWARD_PER_REFERRAL} days FREE\n\n#DOZUP #ScreenshotTool ${referralData.referralLink}`,
    };

    Share.share({
      message: messages[platform],
    });

    AnalyticsService.logEvent('referral_shared_platform', { platform });
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.primary} style={{ marginTop: 100 }} />
      </View>
    );
  }

  return (
    <ScrollView 
      style={[styles.container, { backgroundColor: theme.background }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={28} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.text }}>Refer & Earn</Text>
        <View style={{ width: 28 }} />
      </View>

      {/* Hero Card */}
      <View style={[styles.heroCard, { backgroundColor: theme.card }]}>
        <View style={styles.heroIcon}>
          <Icon name="gift" size={48} color={theme.primary} />
        </View>
        <Text style={[styles.heroTitle, { color: theme.text }}>
          Give {REWARD_PER_REFERRAL} Days, Get {REWARD_PER_REFERRAL} Days
        </Text>
        <Text style={[styles.heroSubtitle, { color: theme.textSecondary }}>
          Share DOZ UP with friends and both get {REWARD_PER_REFERRAL} days of Pro free!
        </Text>
      </View>

      {/* Stats */}
      <View style={styles.statsContainer}>
        <View style={[styles.statCard, { backgroundColor: theme.card }]}>
          <Text style={[styles.statValue, { color: theme.primary }]}>
            {referralData.successfulReferrals}
          </Text>
          <Text style={[styles.statLabel, { color: theme.textSecondary }}>
            Successful Referrals
          </Text>
        </View>

        <View style={[styles.statCard, { backgroundColor: theme.card }]}>
          <Text style={[styles.statValue, { color: theme.success }]}>
            {referralData.rewardDays}
          </Text>
          <Text style={[styles.statLabel, { color: theme.textSecondary }}>
            Days Earned
          </Text>
        </View>

        <View style={[styles.statCard, { backgroundColor: theme.card }]}>
          <Text style={[styles.statValue, { color: theme.warning }]}>
            {referralData.totalReferrals - referralData.successfulReferrals}
          </Text>
          <Text style={[styles.statLabel, { color: theme.textSecondary }}>
            Pending
          </Text>
        </View>
      </View>

      {/* Referral Code */}
      <View style={[styles.codeSection, { backgroundColor: theme.card }]}>
        <Text style={[styles.sectionTitle, { color: theme.text }}>Your Referral Code</Text>
        
        <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
          <TouchableOpacity
            style={[styles.codeCard, { backgroundColor: theme.background }]}
            onPress={copyCode}
            activeOpacity={0.8}
          >
            <Text style={[styles.codeText, { color: theme.text }}>
              {referralData.referralCode}
            </Text>
            
            <View style={styles.copyButton}>
              <Icon 
                name={copied ? 'check' : 'content-copy'} 
                size={20} 
                color={copied ? theme.success : theme.primary} 
              />
            </View>
          </TouchableOpacity>
        </Animated.View>

        {copied && (
          <Text style={[styles.copiedText, { color: theme.success }}>
            Code copied to clipboard!
          </Text>
        )}

        <Text style={[styles.codeHint, { color: theme.textSecondary }}>
          Tap to copy your unique referral code
        </Text>
      </View>

      {/* Share Options */}
      <View style={styles.shareSection}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Share With Friends</Text>

        <View style={styles.shareGrid}>
          <TouchableOpacity
            style={[styles.shareButton, { backgroundColor: '#25D366' }]}
            onPress={() => shareVia('whatsapp')}
          >
            <Icon name="whatsapp" size={28} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.shareButton, { backgroundColor: '#0088cc' }]}
            onPress={() => shareVia('telegram')}
          >
            <Icon name="send" size={28} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.shareButton, { backgroundColor: '#1DA1F2' }]}
            onPress={() => shareVia('twitter')}
          >
            <Icon name="twitter" size={28} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.shareButton, { backgroundColor: theme.primary }]}
            onPress={shareLink}
          >
            <Icon name="share-variant" size={28} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* How It Works */}
      <View style={styles.howItWorks}>
        <Text style={[styles.sectionTitle, { color: theme.text }}>How It Works</Text>

        {[
          {
            icon: 'share-circle',
            title: 'Share Your Code',
            description: 'Send your unique code to friends',
          },
          {
            icon: 'account-plus',
            title: 'Friend Signs Up',
            description: 'They create an account using your code',
          },
          {
            icon: 'gift-open',
            title: 'Both Get Rewarded',
            description: `You both get ${REWARD_PER_REFERRAL} days of Pro free!`,
          },
        ].map((step, index) => (
          <View key={index} style={styles.stepItem}>
            <View style={[styles.stepNumber, { backgroundColor: theme.primary + '20' }]}>
              <Text style={[styles.stepNumberText, { color: theme.primary }]}>{index + 1}</Text>
            </View>
            <View style={styles.stepContent}>
              <Icon name={step.icon} size={24} color={theme.primary} />
              <View style={{ marginLeft: 12 }}>
                <Text style={[styles.stepTitle, { color: theme.text }}>{step.title}</Text>
                <Text style={[styles.stepDesc, { color: theme.textSecondary }}>
                  {step.description}
                </Text>
              </View>
            </View>
          </View>
        ))}
      </View>

      {/* Referral History */}
      {referralData.referrals?.length > 0 && (
        <View style={[styles.historySection, { backgroundColor: theme.card }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }}>Referral History</Text>

          {referralData.referrals.slice(0, 5).map((referral, index) => (
            <View key={index} style={styles.historyItem}>
              <View style={styles.historyLeft}>
                <View 
                  style={[
                    styles.historyStatus,
                    { 
                      backgroundColor: 
                        referral.status === 'converted' 
                          ? theme.success + '20' 
                          : theme.warning + '20',
                    },
                  ]}
                >
                  <Icon 
                    name={referral.status === 'converted' ? 'check' : 'clock-outline'} 
                    size={16}
                    color={referral.status === 'converted' ? theme.success : theme.warning}
                  />
                </View>
                
                <View style={{ marginLeft: 12 }}>
                  <Text style={[styles.historyEmail, { color: theme.text }}>
                    {referral.referredEmail}
                  </Text>
                  <Text style={[styles.historyDate, { color: theme.textSecondary }}>
                    {new Date(referral.created).toLocaleDateString()}
                  </Text>
                </View>
              </View>

              <Text 
                style={[
                  styles.historyStatusText,
                  { 
                    color: 
                      referral.status === 'converted' 
                        ? theme.success 
                        : theme.warning,
                  },
                ]}
              >
                {referral.status === 'converted' ? '+30 days' : 'Pending'}
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
  },
  heroCard: {
    margin: 20,
    padding: 30,
    borderRadius: 24,
    alignItems: 'center',
  },
  heroIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12,
  },
  heroSubtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
  },
  statCard: {
    flex: 1,
    padding: 20,
    borderRadius: 20,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 32,
    fontWeight: '800',
  },
  statLabel: {
    fontSize: 12,
    marginTop: 4,
  },
  codeSection: {
    margin: 20,
    padding: 24,
    borderRadius: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 20,
  },
  codeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(99, 102, 241, 0.3)',
  },
  codeText: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 2,
  },
  copyButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  copiedText: {
    textAlign: 'center',
    marginTop: 12,
    fontWeight: '600',
  },
  codeHint: {
    textAlign: 'center',
    marginTop: 12,
    fontSize: 13,
  },
  shareSection: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  shareGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  shareButton: {
    width: 70,
    height: 70,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  howItWorks: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  stepItem: {
    marginBottom: 20,
  },
  stepNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  stepNumberText: {
    fontSize: 16,
    fontWeight: '700',
  },
  stepContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  stepDesc: {
    fontSize: 14,
  },
  historySection: {
    margin: 20,
    padding: 24,
    borderRadius: 24,
  },
  historyItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  historyLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  historyStatus: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  historyEmail: {
    fontSize: 14,
    fontWeight: '600',
  },
  historyDate: {
    fontSize: 12,
    marginTop: 2,
  },
  historyStatusText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
