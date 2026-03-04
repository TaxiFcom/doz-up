import React from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { useAuth } from '../context/AuthContext';

export default function AuthScreen() {
  const { login } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Login</Text>
      <TextInput style={styles.input} placeholder="Email" placeholderTextColor="#666" />
      <TextInput style={styles.input} placeholder="Password" placeholderTextColor="#666" secureTextEntry />
      <TouchableOpacity style={styles.button} onPress={() => login('test@test.com', 'password')}>
        <Text style={styles.buttonText}>Login</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#0a0a12' },
  title: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 30 },
  input: { backgroundColor: 'rgba(255,255,255,0.1)', padding: 16, borderRadius: 12, marginBottom: 16, color: '#fff' },
  button: { backgroundColor: '#6366f1', padding: 16, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
