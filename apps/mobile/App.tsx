import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";

export default function App() {
  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        PocketLedger
      </Text>
      <Text style={styles.description}>
        Mobile workspace ready. Navigation and screens will be added in Issue
        #9.
      </Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 24
  },
  description: {
    textAlign: "center"
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 12
  }
});
