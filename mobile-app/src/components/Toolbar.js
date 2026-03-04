import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function Toolbar({ selectedTool, onSelectTool, selectedColor, onSelectColor, strokeWidth, onChangeStrokeWidth }) {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Toolbar</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: 'rgba(255,255,255,0.05)' },
  text: { color: '#fff' },
});
