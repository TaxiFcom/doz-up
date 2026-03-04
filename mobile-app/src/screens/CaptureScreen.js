import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Image,
  PanResponder,
  Alert,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ViewShot from 'react-native-view-shot';
import RNFS from 'react-native-fs';
import { launchImageLibrary, launchCamera } from 'react-native-image-crop-picker';

import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useSubscription } from '../context/SubscriptionContext';
import ScreenshotCapture from '../native/ScreenshotCapture';
import CanvasEditor from '../components/CanvasEditor';
import Toolbar from '../components/Toolbar';
import UploadService from '../services/UploadService';
import AnalyticsService from '../services/AnalyticsService';

const { width, height } = Dimensions.get('window');

const TOOLS = [
  { id: 'screenshot', icon: 'cellphone-screenshot', label: 'Screenshot' },
  { id: 'gallery', icon: 'image', label: 'Gallery' },
  { id: 'camera', icon: 'camera', label: 'Camera' },
];

export default function CaptureScreen() {
  const navigation = useNavigation();
  const { theme } = useTheme();
  const { user } = useAuth();
  const { subscription } = useSubscription();
  
  const [selectedTool, setSelectedTool] = useState('screenshot');
  const [capturedImage, setCapturedImage] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedColor, setSelectedColor] = useState('#ef4444');
  const [selectedToolType, setSelectedToolType] = useState('pen');
  const [strokeWidth, setStrokeWidth] = useState(3);
  
  const viewShotRef = useRef(null);
  const canvasRef = useRef(null);

  // Check if user has reached limit
  const canCapture = () => {
    if (!subscription) return false;
    if (subscription.plan === 'free' && subscription.usage >= 15) {
      Alert.alert(
        'Free Limit Reached',
        'You have reached your 15 screenshots limit. Upgrade to Pro for unlimited captures.',
        [
          { text: 'Not Now', style: 'cancel' },
          { text: 'Upgrade', onPress: () => navigation.navigate('Subscription') },
        ]
      );
      return false;
    }
    return true;
  };

  // Take screenshot using native module
  const takeScreenshot = async () => {
    if (!canCapture()) return;

    try {
      AnalyticsService.logEvent('screenshot_attempt');
      
      // Native screenshot capture
      const uri = await ScreenshotCapture.capture();
      
      if (uri) {
        setCapturedImage(uri);
        setIsEditing(true);
        AnalyticsService.logEvent('screenshot_captured');
      }
    } catch (error) {
      console.error('Screenshot error:', error);
      Alert.alert('Error', 'Failed to capture screenshot. Please try again.');
    }
  };

  // Pick from gallery
  const pickFromGallery = async () => {
    if (!canCapture()) return;

    try {
      const image = await launchImageLibrary({
        mediaType: 'photo',
        cropping: true,
        freeStyleCropEnabled: true,
      });

      if (image.path) {
        setCapturedImage(image.path);
        setIsEditing(true);
        AnalyticsService.logEvent('image_imported');
      }
    } catch (error) {
      console.log('Gallery cancelled or error:', error);
    }
  };

  // Take photo with camera
  const takePhoto = async () => {
    if (!canCapture()) return;

    try {
      const image = await launchCamera({
        mediaType: 'photo',
        cropping: true,
      });

      if (image.path) {
        setCapturedImage(image.path);
        setIsEditing(true);
        AnalyticsService.logEvent('photo_captured');
      }
    } catch (error) {
      console.log('Camera cancelled or error:', error);
    }
  };

  // Handle tool selection
  const handleToolSelect = (toolId) => {
    setSelectedTool(toolId);
    
    switch (toolId) {
      case 'screenshot':
        takeScreenshot();
        break;
      case 'gallery':
        pickFromGallery();
        break;
      case 'camera':
        takePhoto();
        break;
    }
  };

  // Save edited image
  const saveEdit = async () => {
    try {
      const editedUri = await canvasRef.current?.exportImage();
      if (editedUri) {
        setCapturedImage(editedUri);
        setIsEditing(false);
      }
    } catch (error) {
      console.error('Save error:', error);
    }
  };

  // Upload and get share link
  const uploadAndShare = async () => {
    if (!capturedImage) return;

    setIsUploading(true);
    
    try {
      const result = await UploadService.uploadImage(capturedImage, {
        userId: user?.id,
        filename: `screenshot_${Date.now()}.png`,
      });

      if (result.success && result.url) {
        // Update usage
        await UploadService.updateUsage(user?.id);
        
        // Navigate to share screen
        navigation.navigate('Share', {
          imageUri: capturedImage,
          shareUrl: result.url,
          shortCode: result.shortCode,
        });
        
        AnalyticsService.logEvent('image_uploaded', {
          has_annotations: isEditing,
        });
      } else {
        Alert.alert('Upload Failed', result.error || 'Please try again.');
      }
    } catch (error) {
      console.error('Upload error:', error);
      Alert.alert('Error', 'Failed to upload. Please check your connection.');
    } finally {
      setIsUploading(false);
    }
  };

  // Discard and retake
  const discardImage = () => {
    Alert.alert(
      'Discard Image?',
      'Are you sure you want to discard this screenshot?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Discard', 
          style: 'destructive',
          onPress: () => {
            setCapturedImage(null);
            setIsEditing(false);
          }
        },
      ]
    );
  };

  // If editing, show editor
  if (isEditing && capturedImage) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={discardImage}>
            <Icon name="close" size={28} color={theme.text} />
          </TouchableOpacity>
          
          <Text style={[styles.headerTitle, { color: theme.text }]}>
            Edit Screenshot
          </Text>
          
          <TouchableOpacity onPress={saveEdit}>
            <Icon name="check" size={28} color={theme.primary} />
          </TouchableOpacity>
        </View>

        {/* Canvas Editor */}
        <View style={styles.editorContainer}>
          <CanvasEditor
            ref={canvasRef}
            imageUri={capturedImage}
            selectedTool={selectedToolType}
            selectedColor={selectedColor}
            strokeWidth={strokeWidth}
          />
        </View>

        {/* Toolbar */}
        <Toolbar
          selectedTool={selectedToolType}
          onSelectTool={setSelectedToolType}
          selectedColor={selectedColor}
          onSelectColor={setSelectedColor}
          strokeWidth={strokeWidth}
          onChangeStrokeWidth={setStrokeWidth}
        />

        {/* Action Buttons */}
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[styles.uploadButton, { backgroundColor: theme.primary }]}
            onPress={uploadAndShare}
            disabled={isUploading}
          >
            {isUploading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Icon name="cloud-upload" size={24} color="#fff" />
                <Text style={styles.uploadButtonText}>Get Share Link</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Main capture screen
  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Capture</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Settings')}>
          <Icon name="cog" size={24} color={theme.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Quick Capture Button */}
      <View style={styles.mainCapture}>
        <TouchableOpacity
          style={[styles.captureButton, { backgroundColor: theme.primary }]}
          onPress={takeScreenshot}
          activeOpacity={0.8}
        >
          <View style={styles.captureButtonInner}>
            <Icon name="cellphone-screenshot" size={48} color="#fff" />
          </View>
        </TouchableOpacity>
        
        <Text style={[styles.captureLabel, { color: theme.text }]}>
          Tap to Capture Screen
        </Text>
        <Text style={[styles.captureSubLabel, { color: theme.textSecondary }]}>
          Or use volume down + power button
        </Text>
      </View>

      {/* Tool Selection */}
      <View style={styles.toolsContainer}>
        <Text style={[styles.sectionTitle, { color: theme.textSecondary }}>
          Other Options
        </Text>
        
        <View style={styles.toolsGrid}>
          {TOOLS.map((tool) => (
            <TouchableOpacity
              key={tool.id}
              style={[
                styles.toolButton,
                { 
                  backgroundColor: selectedTool === tool.id 
                    ? theme.primary + '20' 
                    : theme.card,
                  borderColor: selectedTool === tool.id 
                    ? theme.primary 
                    : theme.border,
                },
              ]}
              onPress={() => handleToolSelect(tool.id)}
            >
              <Icon 
                name={tool.icon} 
                size={32} 
                color={selectedTool === tool.id ? theme.primary : theme.text} 
              />
              <Text style={[
                styles.toolLabel, 
                { 
                  color: selectedTool === tool.id ? theme.primary : theme.text,
                },
              ]}>
                {tool.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Usage Info */}
      {subscription && subscription.plan === 'free' && (
        <View style={[styles.usageBar, { backgroundColor: theme.card }]}>
          <View style={styles.usageHeader}>
            <Text style={{ color: theme.text, fontWeight: '600' }}>
              Free Plan Usage
            </Text>
            <Text style={{ color: theme.primary, fontWeight: '700' }}>
              {subscription.usage}/15
            </Text>
          </View>
          <View style={[styles.usageProgress, { backgroundColor: theme.border }]}>
            <View 
              style={[
                styles.usageFill, 
                { 
                  width: `${(subscription.usage / 15) * 100}%`,
                  backgroundColor: subscription.usage >= 15 ? theme.error : theme.primary,
                },
              ]} 
            />
          </View>
          
          {subscription.usage >= 10 && (
            <TouchableOpacity
              style={styles.upgradePrompt}
              onPress={() => navigation.navigate('Subscription')}
            >
              <Text style={{ color: theme.primary, fontWeight: '600' }}>
                ⚡ Running low? Upgrade to Pro
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Pro Badge */}
      {subscription?.plan === 'pro' && (
        <View style={[styles.proBadge, { backgroundColor: theme.success + '20' }]}>
          <Icon name="crown" size={20} color={theme.success} />
          <Text style={{ color: theme.success, marginLeft: 8, fontWeight: '600' }}>
            Pro Member - Unlimited Captures
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  mainCapture: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  captureButton: {
    width: 140,
    height: 140,
    borderRadius: 70,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  captureButtonInner: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureLabel: {
    marginTop: 20,
    fontSize: 20,
    fontWeight: '700',
  },
  captureSubLabel: {
    marginTop: 8,
    fontSize: 14,
  },
  toolsContainer: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 16,
  },
  toolsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  toolButton: {
    width: 100,
    height: 100,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
  },
  toolLabel: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '600',
  },
  editorContainer: {
    flex: 1,
    margin: 20,
    borderRadius: 20,
    overflow: 'hidden',
  },
  actionButtons: {
    padding: 20,
    paddingBottom: 40,
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 16,
    gap: 12,
  },
  uploadButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  usageBar: {
    margin: 20,
    padding: 16,
    borderRadius: 16,
  },
  usageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  usageProgress: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  usageFill: {
    height: '100%',
    borderRadius: 4,
  },
  upgradePrompt: {
    marginTop: 12,
    alignItems: 'center',
  },
  proBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    margin: 20,
    padding: 12,
    borderRadius: 12,
  },
});
