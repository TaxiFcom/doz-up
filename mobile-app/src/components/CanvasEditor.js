import React, { forwardRef } from 'react';
import { View, StyleSheet } from 'react-native';

const CanvasEditor = forwardRef(({ imageUri, selectedTool, selectedColor, strokeWidth }, ref) => {
  return (
    <View style={styles.container}>
      <View style={styles.canvas} />
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  canvas: { flex: 1 },
});

export default CanvasEditor;
