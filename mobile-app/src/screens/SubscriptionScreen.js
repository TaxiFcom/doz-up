import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Dimensions,
} from 'react-native';
import { useStripe, usePaymentSheet } from '@stripe/stripe-react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../config';

const { width } = Dimensions.get('window');

const PLANS = [
  {
    id: 'starter_monthly',
    name: 'Starter',
    price: 333,
    priceDisplay: '$3.33',
    period: '/month',
    description: 'Perfect for individuals',
    features: [
      'Unlimited screenshots',
      '1GB Cloud Storage',
      '30-day link expiry',
      'Basic annotations',
      'Email support',
    ],
    notIncluded: ['API access', 'Team features'],
    color: '#6366f1',
  },
  {
    id: 'pro_monthly',
    name: 'Pro',
    price: 999,
    priceDisplay: '$9.99',
    period: '/month',
    description: 'For power users',
    features: [
      'Everything in Starter',
      '10GB Cloud Storage',
      'Links never expire',
      'Advanced annotations',
      'Priority support',
      'API access',
    ],
    popular: true,
    color: '#10b981',
  },
  {
    id: 'business_monthly',
    name: 'Business',
    price: 2999,
    priceDisplay: '$29.99',
    period: '/month',
    description: 'For teams',
    features: [
      'Everything in Pro',
      '100GB Cloud Storage',
      'Team collaboration',
      'Admin dashboard',
      'SSO integration',
      'Dedicated support',
    ],
    color: '#f59e0b',
  },
];

const YEARLY_PLANS = [
  {
    id: 'starter_yearly',
    name: 'Starter',
    price: 2664,
    priceDisplay: '$2.22',
    originalPrice: '$3.33',
    period: '/month',
    description: 'Billed $26.64/year',
    savings: 'Save $16/year',
    features: [
      'Unlimited screenshots',
      '1GB Cloud Storage',
      '30-day link expiry',
      'Basic annotations',
      'Email support',
    ],
    color: '#6366f1',
  },
  {
    id: 'pro_yearly',
    name: 'Pro',
    price: 7992,
    priceDisplay: '$6.66',
    originalPrice: '$9.99',
    period: '/month',
    description: 'Billed $79.92/year',
    savings: 'Save $40/year',
    popular: true,
    features: [
      'Everything in Starter',
      '10GB Cloud Storage',
      'Links never expire',
      'Advanced annotations',
      'Priority support',
      'API access',
    ],
    color: '#10b981',
  },
  {
    id: 'business_yearly',
    name: 'Business',
    price: 23992,
    priceDisplay: '$19.99',
    originalPrice: '$29.99',
    period: '/month',
    description: 'Billed $239.92/year',
    savings: 'Save $120/year',
    features: [
      'Everything in Pro',
      '100GB Cloud Storage',
      'Team collaboration',
      'Admin dashboard',
      'SSO integration',
      'Dedicated support',
    ],
    color: '#f59e0b',
  },
];

export default function SubscriptionScreen() {
  const navigation = useNavigation();
  const { theme } = useTheme();
  const { user, refreshUser } = useAuth();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  
  const [isYearly, setIsYearly] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [processingPlan, setProcessingPlan] = useState(null);
  const [paymentSheetReady, setPaymentSheetReady] = useState(false);

  const currentPlans = isYearly ? YEARLY_PLANS : PLANS;

  // Initialize payment sheet
  const initializePayment = async (plan) => {
    try {
      setProcessingPlan(plan.id);
      
      // Create payment intent on server
      const response = await fetch(`${API_BASE_URL}/api/payments/create-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: plan.id,
          userId: user?.id,
          amount: plan.price,
        }),
      });

      const { clientSecret, ephemeralKey, customerId } = await response.json();

      const { error } = await initPaymentSheet({
        merchantDisplayName: 'DOZ UP',
        customerId: customerId,
        customerEphemeralKeySecret: ephemeralKey,
        paymentIntentClientSecret: clientSecret,
        allowsDelayedPaymentMethods: true,
        defaultBillingDetails: {
          email: user?.email,
        },
      });

      if (error) {
        Alert.alert('Error', error.message);
        setProcessingPlan(null);
        return false;
      }

      setPaymentSheetReady(true);
      return true;
    } catch (error) {
      console.error('Payment init error:', error);
      Alert.alert('Error', 'Failed to initialize payment. Please try again.');
      setProcessingPlan(null);
      return false;
    }
  };

  // Open payment sheet
  const openPaymentSheet = async () => {
    const { error } = await presentPaymentSheet();

    if (error) {
      Alert.alert(`Error code: ${error.code}`, error.message);
      setProcessingPlan(null);
    } else {
      // Payment successful
      Alert.alert(
        'Success!',
        'Your subscription is now active.',
        [{ text: 'OK', onPress: () => {
          refreshUser();
          navigation.goBack();
        }}]
      );
    }
  };

  // Handle plan selection
  const handleSelectPlan = async (plan) => {
    if (loading) return;
    
    setSelectedPlan(plan);
    setLoading(true);

    const success = await initializePayment(plan);
    if (success) {
      await openPaymentSheet();
    }

    setLoading(false);
    setProcessingPlan(null);
  };

  // Start free trial
  const startFreeTrial = async () => {
    Alert.alert(
      'Start Free Trial',
      'Get 14 days of Pro features for free! No credit card required.',
      [
        { text: 'Not Now', style: 'cancel' },
        { 
          text: 'Start Trial', 
          onPress: async () => {
            try {
              const response = await fetch(`${API_BASE_URL}/api/start-trial`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: user?.id }),
              });
              
              const data = await response.json();
              
              if (data.success) {
                Alert.alert(
                  'Trial Started!',
                  'You now have 14 days of Pro features. Enjoy!',
                  [{ text: 'OK', onPress: refreshUser }]
                );
              }
            } catch (error) {
              Alert.alert('Error', 'Failed to start trial. Please try again.');
            }
          }
        },
      ]
    );
  };

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
        <Text style={[styles.title, { color: theme.text }}>Choose Your Plan</Text>
        <View style={{ width: 28 }} />
      </View>

      {/* Billing Toggle */}
      <View style={styles.billingToggle}>
        <TouchableOpacity
          style={[
            styles.toggleButton,
            !isYearly && { backgroundColor: theme.primary },
          ]}
          onPress={() => setIsYearly(false)}
        >
          <Text style={[!isYearly ? styles.toggleTextActive : { color: theme.textSecondary }]}>
            Monthly
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[
            styles.toggleButton,
            isYearly && { backgroundColor: theme.primary },
          ]}
          onPress={() => setIsYearly(true)}
        >
          <Text style={[isYearly ? styles.toggleTextActive : { color: theme.textSecondary }]}>
            Yearly
          </Text>
          {!isYearly && <Text style={styles.saveBadge}>Save 33%</Text>}
        </TouchableOpacity>
      </View>

      {/* Plans */}
      <View style={styles.plansContainer}>
        {currentPlans.map((plan) => (
          <TouchableOpacity
            key={plan.id}
            style={[
              styles.planCard,
              { 
                backgroundColor: theme.card,
                borderColor: plan.popular ? plan.color : theme.border,
                borderWidth: plan.popular ? 2 : 1,
              },
            ]}
            onPress={() => handleSelectPlan(plan)}
            disabled={loading}
            activeOpacity={0.8}
          >
            {plan.popular && (
              <View style={[styles.popularBadge, { backgroundColor: plan.color }]}>
                <Text style={styles.popularText}>Most Popular</Text>
              </View>
            )}

            <View style={styles.planHeader}>
              <View style={[styles.planIcon, { backgroundColor: plan.color + '20' }]}>
                <Icon 
                  name={plan.id.includes('business') ? 'office-building' : plan.popular ? 'crown' : 'star'} 
                  size={28} 
                  color={plan.color} 
                />
              </View>
              <View>
                <Text style={[styles.planName, { color: theme.text }}>{plan.name}</Text>
                <Text style={{ color: theme.textSecondary, fontSize: 13 }}>
                  {plan.description}
                </Text>
              </View>
            </View>

            <View style={styles.priceContainer}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
                {plan.originalPrice && (
                  <Text style={[styles.originalPrice, { color: theme.textSecondary }]}>
                    {plan.originalPrice}
                  </Text>
                )}
                <Text style={[styles.price, { color: theme.text }}>
                  {plan.priceDisplay}
                </Text>
                <Text style={[styles.period, { color: theme.textSecondary }}>
                  {plan.period}
                </Text>
              </View>
              
              {plan.savings && (
                <Text style={[styles.savings, { color: theme.success }]}>{plan.savings}</Text>
              )}
            </View>

            <View style={styles.featuresList}>
              {plan.features.map((feature, index) => (
                <View key={index} style={styles.featureItem}>
                  <Icon name="check-circle" size={18} color={theme.success} />
                  <Text style={[styles.featureText, { color: theme.text }]}>{feature}</Text>
                </View>
              ))}
              
              {plan.notIncluded?.map((feature, index) => (
                <View key={`not-${index}`} style={styles.featureItem}>
                  <Icon name="close-circle" size={18} color={theme.textSecondary} />
                  <Text style={[styles.featureText, { color: theme.textSecondary }]}>{feature}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={[
                styles.selectButton,
                { backgroundColor: plan.color },
                processingPlan === plan.id && { opacity: 0.7 },
              ]}
              onPress={() => handleSelectPlan(plan)}
              disabled={loading}
            >
              {processingPlan === plan.id ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.selectButtonText}>Select Plan</Text>
              )}
            </TouchableOpacity>
          </TouchableOpacity>
        ))}
      </View>

      {/* Free Trial Section */}
      <View style={[styles.trialSection, { backgroundColor: theme.card }]}>
        <View style={styles.trialHeader}>
          <Icon name="gift" size={32} color={theme.primary} />
          <View style={{ marginLeft: 16 }}>
            <Text style={[styles.trialTitle, { color: theme.text }}>
              Start 14-Day Free Trial
            </Text>
            <Text style={{ color: theme.textSecondary, marginTop: 4 }}>
              Try Pro features free. No credit card required.
            </Text>
          </View>
        </View>
        
        <TouchableOpacity
          style={[styles.trialButton, { borderColor: theme.primary }]}
          onPress={startFreeTrial}
        >
          <Text style={[styles.trialButtonText, { color: theme.primary }]}>
            Start Free Trial
          </Text>
        </TouchableOpacity>
      </View>

      {/* Guarantees */}
      <View style={styles.guarantees}>
        <View style={styles.guaranteeItem}>
          <Icon name="shield-check" size={20} color={theme.success} />
          <Text style={{ color: theme.textSecondary, marginLeft: 8, fontSize: 13 }}>
            30-Day Money-Back Guarantee
          </Text>
        </View>
        
        <View style={styles.guaranteeItem}>
          <Icon name="cancel" size={20} color={theme.success} />
          <Text style={{ color: theme.textSecondary, marginLeft: 8, fontSize: 13 }}>
            Cancel Anytime
          </Text>
        </View>
      </View>
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
  billingToggle: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginHorizontal: 20,
    marginBottom: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 4,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    position: 'relative',
  },
  toggleTextActive: {
    color: '#fff',
    fontWeight: '700',
  },
  saveBadge: {
    position: 'absolute',
    top: -10,
    right: 10,
    backgroundColor: '#10b981',
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  plansContainer: {
    paddingHorizontal: 20,
  },
  planCard: {
    borderRadius: 24,
    padding: 24,
    marginBottom: 20,
    position: 'relative',
  },
  popularBadge: {
    position: 'absolute',
    top: -12,
    left: '50%',
    transform: [{ translateX: -60 }],
    paddingHorizontal: 20,
    paddingVertical: 6,
    borderRadius: 20,
  },
  popularText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  planIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  planName: {
    fontSize: 24,
    fontWeight: '800',
  },
  priceContainer: {
    marginBottom: 20,
  },
  originalPrice: {
    fontSize: 20,
    textDecorationLine: 'line-through',
    marginRight: 8,
  },
  price: {
    fontSize: 36,
    fontWeight: '800',
  },
  period: {
    fontSize: 16,
    marginBottom: 4,
  },
  savings: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
  },
  featuresList: {
    marginBottom: 20,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  featureText: {
    marginLeft: 12,
    fontSize: 15,
  },
  selectButton: {
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  selectButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  trialSection: {
    margin: 20,
    padding: 24,
    borderRadius: 24,
  },
  trialHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  trialTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  trialButton: {
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 2,
  },
  trialButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  guarantees: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    paddingBottom: 40,
  },
  guaranteeItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
