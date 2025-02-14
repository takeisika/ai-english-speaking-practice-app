// HistoryScreen.js (ゴミ箱ボタンを右下に変更する例)

import React, { useState, useEffect } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  SafeAreaView
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import * as FileSystem from 'expo-file-system';

// カラー
const DARK_BLUE     = '#2C3E50';
const STOP_RED      = '#D0021B';
const ACCENT_ORANGE = '#F5A623';
const PIN_BG        = '#eef8f2';
const TRASH_RED     = '#c0392b';

export default function HistoryScreen({ navigation }) {
  const [logs, setLogs] = useState([]);
  const [sound, setSound] = useState(null);
  const [playingKey, setPlayingKey] = useState(null);

  // まとめて削除用
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedPins, setSelectedPins] = useState([]);

  useEffect(() => {
    loadLogs();
    return () => {
      if (sound) {
        sound.unloadAsync();
      }
    };
  }, []);

  const loadLogs = async () => {
    const logsKey = 'SESSION_LOGS';
    const logsJson = await AsyncStorage.getItem(logsKey);
    if (logsJson) {
      const data = JSON.parse(logsJson);
      setLogs(data.reverse()); // 最新を上に
    }
  };

  const handleGoBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('Recorder');
    }
  };

  const stopCurrentClip = async () => {
    try {
      if (sound) {
        const st = await sound.getStatusAsync();
        if (st.isPlaying) {
          await sound.stopAsync();
        }
        await sound.unloadAsync();
      }
      setPlayingKey(null);
    } catch (err) {
      console.error('Stop error:', err);
    }
  };

  const handlePlayClip = async (pin, sessionId, pinIndex) => {
    const key = `${sessionId}-${pinIndex}-orig`;
    if (!pin.analysis?.clipUri) {
      Alert.alert('No partial file');
      return;
    }
    if (playingKey && playingKey !== key) {
      Alert.alert('他のPINを再生中です');
      return;
    }
    if (playingKey === key) {
      await stopCurrentClip();
      return;
    }

    try {
      if (sound) {
        await sound.unloadAsync();
      }
      const { sound: newSound } = await Audio.Sound.createAsync({
        uri: pin.analysis.clipUri
      });
      setSound(newSound);
      setPlayingKey(key);

      newSound.setOnPlaybackStatusUpdate((status) => {
        if (status.didJustFinish) {
          newSound.unloadAsync();
          setPlayingKey(null);
        }
      });
      await newSound.playAsync();
    } catch (err) {
      console.error('Play error:', err);
      setPlayingKey(null);
    }
  };

  const handlePlayTTS = async (pin, sessionId, pinIndex) => {
    const key = `${sessionId}-${pinIndex}-tts`;
    if (!pin.analysis?.suggestion) {
      Alert.alert('No suggestion text');
      return;
    }
    if (playingKey && playingKey !== key) {
      Alert.alert('他のPINを再生中です');
      return;
    }
    if (playingKey && playingKey.includes('-orig')) {
      await stopCurrentClip();
    }

    if (playingKey === key) {
      Speech.stop();
      setPlayingKey(null);
      return;
    }

    setPlayingKey(key);
    Speech.speak(pin.analysis.suggestion, {
      language: 'en-US',
      onDone: () => setPlayingKey(null),
      onStopped: () => setPlayingKey(null),
      onError: () => setPlayingKey(null)
    });
  };

  const getOriginalDisplayText = (originalText) => {
    if (!originalText) return '- - -';
    const hasSingleDot = /(?:^|\s)\.(?:\s|$)/.test(originalText);
    if (originalText.includes('$') || hasSingleDot) {
      return '- - -';
    }
    return originalText;
  };

  const formatTime = (sec) => {
    if (sec < 0) sec = 0;
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  const formatRelativeOrDate = (isoStr) => {
    if (!isoStr) return 'Unknown Time';
    const now = new Date();
    const dateObj = new Date(isoStr);
    const diffMs = now - dateObj;
    if (diffMs < 0) return 'Unknown Time';

    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) {
      return `${diffSec}s ago`;
    }
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) {
      return `${diffMin}m ago`;
    }
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) {
      return `${diffHour}h ago`;
    }
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 7) {
      return `${diffDay}d ago`;
    }

    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    return `${yyyy}/${mm}/${dd}`;
  };

  // ---- 個別削除 ----
  const handleDeletePin = async (sessionId, pinIndex) => {
    try {
      await stopCurrentClip();

      const newLogs = [...logs];
      const sessionIdx = newLogs.findIndex((s) => s.sessionId === sessionId);
      if (sessionIdx < 0) return;

      const targetPin = newLogs[sessionIdx].pinned[pinIndex];
      if (!targetPin) return;

      // ファイル削除
      if (targetPin.analysis?.clipUri) {
        await FileSystem.deleteAsync(targetPin.analysis.clipUri, { idempotent: true })
          .catch(() => {});
      }

      // PIN削除
      newLogs[sessionIdx].pinned.splice(pinIndex, 1);

      // ピンが空ならセッション自体削除
      if (newLogs[sessionIdx].pinned.length === 0) {
        newLogs.splice(sessionIdx, 1);
      }

      await AsyncStorage.setItem('SESSION_LOGS', JSON.stringify([...newLogs].reverse()));
      setLogs(newLogs);
      Alert.alert('Deleted', 'Pin was removed successfully');
    } catch (err) {
      console.error('handleDeletePin error:', err);
      Alert.alert('Error', err.message);
    }
  };

  // ========== まとめて削除関連 ==========
  const toggleSelecting = () => {
    if (isSelecting) {
      setSelectedPins([]);
    }
    setIsSelecting(!isSelecting);
  };

  const toggleSelectPin = (sessionId, pinIndex) => {
    const key = `${sessionId}_${pinIndex}`;
    const newSelected = [...selectedPins];
    const i = newSelected.indexOf(key);
    if (i >= 0) {
      newSelected.splice(i, 1);
    } else {
      newSelected.push(key);
    }
    setSelectedPins(newSelected);
  };

  const isPinSelected = (sessionId, pinIndex) => {
    const key = `${sessionId}_${pinIndex}`;
    return selectedPins.includes(key);
  };

  const handleDeleteSelected = async () => {
    if (selectedPins.length === 0) {
      Alert.alert('No pins selected');
      return;
    }
    await stopCurrentClip();

    let newLogs = [...logs];

    for (const selKey of selectedPins) {
      const [sid, idxStr] = selKey.split('_');
      const idx = parseInt(idxStr, 10);
      const sessionIdx = newLogs.findIndex((s) => s.sessionId === sid);
      if (sessionIdx < 0) continue;

      const pinItem = newLogs[sessionIdx].pinned[idx];
      if (!pinItem) continue;

      if (pinItem.analysis?.clipUri) {
        await FileSystem.deleteAsync(pinItem.analysis.clipUri, { idempotent: true })
          .catch(() => {});
      }

      newLogs[sessionIdx].pinned[idx] = null;
    }

    // null 除去
    newLogs = newLogs.map((session) => {
      const filteredPins = session.pinned.filter((p) => p !== null);
      return { ...session, pinned: filteredPins };
    });

    // ピンが空ならセッション削除
    newLogs = newLogs.filter((s) => s.pinned.length > 0);

    await AsyncStorage.setItem('SESSION_LOGS', JSON.stringify([...newLogs].reverse()));
    setLogs(newLogs);
    setSelectedPins([]);
    setIsSelecting(false);

    Alert.alert('Deleted', 'Selected pins were removed successfully');
  };

  // =======================
  // Render
  // =======================
  return (
    <SafeAreaView style={styles.safeArea}>
      {/* カスタムヘッダー */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={handleGoBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#000" />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>Recording History</Text>

        {isSelecting ? (
          <View style={styles.headerRightContainer}>
            <TouchableOpacity onPress={handleDeleteSelected} style={styles.deleteMultiBtn}>
              <Text style={{ color: '#fff', fontWeight: '600' }}>Delete</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={toggleSelecting} style={styles.editBtn}>
              <Text style={{ color: '#000', fontWeight: '600' }}>Done</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.headerRightContainer}>
            <TouchableOpacity onPress={toggleSelecting} style={styles.editBtn}>
              <Text style={{ color: '#000', fontWeight: '600' }}>Select</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <ScrollView style={{ flex: 1 }}>
        {logs.length === 0 ? (
          <Text style={styles.noSession}>No recordings found.</Text>
        ) : (
          logs.map((session) => {
            const { sessionId, date, pinned } = session;
            return (
              <View key={sessionId} style={styles.sessionCard}>
                <Text style={styles.title}>
                  {formatRelativeOrDate(date)}
                </Text>

                {!pinned || pinned.length === 0 ? (
                  <Text style={styles.noPin}>No PIN</Text>
                ) : (
                  pinned.map((pin, idx) => {
                    const keyOrig = `${sessionId}-${idx}-orig`;
                    const keyTTS  = `${sessionId}-${idx}-tts`;
                    const isPlayingOrig = (playingKey === keyOrig);
                    const isPlayingTts  = (playingKey === keyTTS);

                    const fromSec = Math.max(0, pin.pinTime - 15);
                    const selected = isPinSelected(sessionId, idx);

                    return (
                      // pinItem: position: 'relative' → deleteBtn small right bottom
                      <View key={idx} style={styles.pinItem}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={styles.pinLabel}>
                            📍{formatTime(fromSec)} - {formatTime(pin.pinTime)}
                          </Text>

                          {/* チェックボックスか何もないか */}
                          {isSelecting && (
                            <TouchableOpacity
                              style={styles.checkBox}
                              onPress={() => toggleSelectPin(sessionId, idx)}
                            >
                              <Ionicons
                                name={selected ? 'checkbox' : 'checkbox-outline'}
                                size={24}
                                color={selected ? DARK_BLUE : '#777'}
                              />
                            </TouchableOpacity>
                          )}
                        </View>

                        {pin.analysis ? (
                          <>
                            <Text style={styles.analysisText}>
                              Original: {getOriginalDisplayText(pin.analysis.original)}
                            </Text>
                            <Text style={styles.analysisText}>
                              AI Correction: {pin.analysis.suggestion}
                            </Text>

                            <View style={styles.actionRow}>
                              {isPlayingOrig ? (
                                <TouchableOpacity
                                  style={[styles.btn, styles.btnStop]}
                                  onPress={stopCurrentClip}
                                  activeOpacity={0.8}
                                >
                                  <Ionicons name="square-outline" size={16} color="#fff" />
                                  <Text style={styles.btnText}>Stop</Text>
                                </TouchableOpacity>
                              ) : (
                                <TouchableOpacity
                                  style={[styles.btn, styles.btnPlay]}
                                  onPress={() => handlePlayClip(pin, sessionId, idx)}
                                  activeOpacity={0.8}
                                >
                                  <Ionicons name="play-circle" size={16} color="#fff" />
                                  <Text style={styles.btnText}>Play</Text>
                                </TouchableOpacity>
                              )}

                              {isPlayingTts ? (
                                <TouchableOpacity
                                  style={[styles.btn, styles.btnTts]}
                                  onPress={() => handlePlayTTS(pin, sessionId, idx)}
                                  activeOpacity={0.8}
                                >
                                  <Ionicons name="square-outline" size={16} color="#fff" />
                                  <Text style={styles.btnText}>Stop</Text>
                                </TouchableOpacity>
                              ) : (
                                <TouchableOpacity
                                  style={[styles.btn, styles.btnTts]}
                                  onPress={() => handlePlayTTS(pin, sessionId, idx)}
                                  activeOpacity={0.8}
                                >
                                  <Ionicons name="volume-high-outline" size={16} color="#fff" />
                                  <Text style={styles.btnText}>AI Correction</Text>
                                </TouchableOpacity>
                              )}
                            </View>
                          </>
                        ) : (
                          <Text style={styles.noAnalysis}>No analysis</Text>
                        )}

                        {/* ここがゴミ箱ボタン(右下) */}
                        {!isSelecting && (
                          <TouchableOpacity
                            style={styles.deleteBtnBottomRight}
                            onPress={() => handleDeletePin(sessionId, idx)}
                          >
                            <Ionicons name="trash" size={14} color="#fff" />
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f5f6fa' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    zIndex: 5
  },
  backBtn: { width: 40 },
  headerTitle: {
    flex: 1,
    color: '#000',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center'
  },
  headerRightContainer: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  editBtn: {
    paddingHorizontal: 10
  },
  deleteMultiBtn: {
    backgroundColor: TRASH_RED,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    marginRight: 8
  },

  noSession: {
    fontSize: 16,
    color: '#7f8c8d',
    textAlign: 'center',
    marginTop: 40
  },
  sessionCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 15,
    marginHorizontal: 15,
    marginTop: 15,
    shadowColor: '#333',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    color: DARK_BLUE,
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ecf0f1',
    paddingBottom: 5
  },
  noPin: {
    fontSize: 14,
    fontStyle: 'italic',
    color: '#bdc3c7'
  },
  pinItem: {
    position: 'relative', // これで中のabsoluteボタンが基準位置を持てる
    backgroundColor: PIN_BG,
    borderWidth: 1,
    borderColor: '#d2e8dc',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10
  },
  pinLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2c3e50'
  },
  noAnalysis: {
    fontSize: 13,
    color: '#bdc3c7',
    fontStyle: 'italic',
    marginVertical: 5
  },
  analysisText: {
    fontSize: 13,
    color: '#2c3e50',
    marginBottom: 5,
    fontStyle: 'italic'
  },
  actionRow: {
    flexDirection: 'row',
    marginTop: 5
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 10,
    shadowColor: '#333',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2
  },
  btnText: {
    marginLeft: 4,
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold'
  },
  btnStop: {
    backgroundColor: STOP_RED
  },
  btnPlay: {
    backgroundColor: DARK_BLUE
  },
  btnTts: {
    backgroundColor: ACCENT_ORANGE
  },

  checkBox: {
    marginLeft: 8
  },

  // 右下ゴミ箱
  deleteBtnBottomRight: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: TRASH_RED,
    alignItems: 'center',
    justifyContent: 'center'
  }
});
















