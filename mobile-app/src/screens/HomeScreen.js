import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

export default function HomeScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>DOZ UP</Text>
      <Text style={styles.subtitle}>Screenshot Tool</Text>
      <TouchableOpacity 
        style={styles.button}
        onPress={() => navigation.navigate('Capture')}
      >
        <Text style={styles.buttonText}>Start Capture</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0a0a12' },
  title: { fontSize: 32, fontWeight: 'bold', color: '#fff' },
  subtitle: { fontSize: 18, color: '#94a3b8', marginTop: 8 },
  button: { marginTop: 40, padding: 16, backgroundColor: '#6366f1', borderRadius: 12 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
