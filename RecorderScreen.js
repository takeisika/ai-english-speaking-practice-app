// RecorderScreen.js
import React, { useState, useRef, useEffect } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  SafeAreaView
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import { FFmpegKit } from 'ffmpeg-kit-react-native';

/**
 * Cloudflare WorkersのURLを設定
 * 例: https://my-openai-proxy.yourname.workers.dev
 *  - /whisper → Whisper API代理
 *  - /chat → ChatCompletion代理
 */
const WORKER_WHISPER_ENDPOINT = 'https://my-openai-proxy.my-openai-proxy.workers.dev/whisper';
const WORKER_CHAT_ENDPOINT = 'https://my-openai-proxy.my-openai-proxy.workers.dev/chat';

// カラー
const DARK_BLUE = '#2C3E50';
const STOP_RED = '#D0021B';
const PIN_BG = '#eef8f2';
const ACCENT_ORANGE = '#F5A623';
const HISTORY_COLOR = '#596775';

export default function RecorderScreen({ navigation }) {
  const [recording, setRecording] = useState(null);
  const [recordedURI, setRecordedURI] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isRecording, setIsRecording] = useState(false);

  // PIN関連
  const [pinnedMoments, setPinnedMoments] = useState([]);
  const [analysisDone, setAnalysisDone] = useState(false);
  const [pinCount, setPinCount] = useState(0);

  // PIN時のポップアップ
  const [pinNotificationVisible, setPinNotificationVisible] = useState(false);

  // 再生管理
  const [sound, setSound] = useState(null);
  const [playingAudioIndex, setPlayingAudioIndex] = useState(null);
  const [playingTtsIndex, setPlayingTtsIndex] = useState(null);

  // AI解析フラグ
  const [trimming, setTrimming] = useState(false);

  const timerRef = useRef(null);
  const startTimeRef = useRef(null);
  const clipTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (sound) {
        sound.unloadAsync();
      }
      if (clipTimeoutRef.current) {
        clearTimeout(clipTimeoutRef.current);
      }
      clearInterval(timerRef.current);
    };
  }, [sound]);

  // --- 録音開始前の設定 ---
  const prepareAudio = async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true
      });
    } catch (err) {
      console.error('Audio mode error:', err);
    }
  };

  // --- 録音開始 ---
  const startRecording = async () => {
    if (isRecording) return;
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('マイク許可が必要です。');
        return;
      }
      await prepareAudio();

      // リセット
      setPinnedMoments([]);
      setAnalysisDone(false);
      setRecordedURI(null);
      setPinCount(0);
      setElapsedTime(0);

      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        const sec = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setElapsedTime(sec);
      }, 1000);

      const { recording } = await Audio.Recording.createAsync(
        Audio.RECORDING_OPTIONS_PRESET_HIGH_QUALITY
      );
      setRecording(recording);
      setIsRecording(true);
    } catch (err) {
      console.error('録音開始失敗:', err);
    }
  };

  // --- 録音停止 ---
  const stopRecording = async () => {
    if (!isRecording) return;
    try {
      clearInterval(timerRef.current);
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      setIsRecording(false);
      setRecordedURI(uri);

      if (pinnedMoments.length > 0) {
        handleAnalyzePins(uri);
      }
    } catch (err) {
      console.error('録音停止失敗:', err);
    }
  };

  // --- PIN ---
  const handlePin = () => {
    if (!isRecording) return;
    const pinSec = Math.floor((Date.now() - startTimeRef.current) / 1000);

    setPinnedMoments((prev) => [...prev, { pinTime: pinSec, analysis: null }]);
    setPinCount((count) => count + 1);

    // ポップアップ表示 → 1秒後に消す
    setPinNotificationVisible(true);
    setTimeout(() => {
      setPinNotificationVisible(false);
    }, 1000);
  };

  // --- PIN解析 ---
  const handleAnalyzePins = async (uri) => {
    if (!uri) return;
    if (pinnedMoments.length === 0) return;

    setTrimming(true);
    try {
      const newPins = [...pinnedMoments];
      for (let i = 0; i < newPins.length; i++) {
        const pin = newPins[i];
        const startSec = pin.pinTime - 15 >= 0 ? pin.pinTime - 15 : 0;
        const durationSec = pin.pinTime - startSec;

        const outPath = `${uri}.pin_${i}.m4a`;
        await trimAudio(uri, outPath, startSec, durationSec);

        // Whisper → GPT校正
        const sttText = await callWhisper(outPath, 'en');
        const suggestion = await callO3MiniWithFallback(sttText);

        newPins[i].analysis = {
          original: sttText,
          suggestion,
          clipUri: outPath
        };
      }
      setPinnedMoments(newPins);
      setAnalysisDone(true);
      setTrimming(false);

      Alert.alert('完了', 'PIN毎にAI校正が完了しました。');
    } catch (err) {
      setTrimming(false);
      console.error(err);
      Alert.alert('Error', err.message);
    }
  };

  // --- ffmpeg でトリミング ---
  const trimAudio = async (inputUri, outputUri, startSec, durationSec) => {
    const inPath = inputUri.replace('file://', '');
    const outPath = outputUri.replace('file://', '');
    // ffmpegコマンド
    const cmd = `-ss ${startSec} -t ${durationSec} -i "${inPath}" -acodec copy "${outPath}"`;
    const session = await FFmpegKit.execute(cmd);
    const returnCode = await session.getReturnCode();
    if (!returnCode.isValueSuccess()) {
      throw new Error(`ffmpeg trim failed: ${returnCode}`);
    }
  };

  // --- Whisper に投げる (Workers経由) ---
  const callWhisper = async (clipUri, lang) => {
    const fData = new FormData();
    fData.append('file', {
      uri: clipUri,
      name: 'pin.m4a',
      type: 'audio/m4a'
    });
    fData.append('model', 'whisper-1');
    if (lang) {
      fData.append('language', lang);
    }
    fData.append('prompt', 'This audio might contain no speech.$');

    // Cloudflare Workers に送信
    const res = await fetch(WORKER_WHISPER_ENDPOINT, {
      method: 'POST',
      body: fData,
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Whisper Error: ${txt}`);
    }
    const data = await res.json();
    return data.text || '- - -';
  };

  // --- GPT 校正: Workers経由でChatCompletionを呼ぶ ---
  const callO3MiniWithFallback = async (sttText) => {
    // sttTextに"$"が含まれている場合は無音扱い
    if (sttText.includes('$')) {
      return 'No correction';
    }

    const prompt = `Output a grammatically correct version of \n${sttText}\n or output "No correction";`;
    let modelForUse = 'o3-mini-2025-01-31';

    const bodyRequest = (modelName) => ({
      model: modelName,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 100,
      temperature: 0.7,
    });

    try {
      const res = await fetch(WORKER_CHAT_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(bodyRequest(modelForUse))
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt);
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content.trim() || '(No Suggestion)';
    } catch (err) {
      // fallback
      if (/model_not_found/i.test(err.message)) {
        modelForUse = 'gpt-4';
        const res2 = await fetch(WORKER_CHAT_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(bodyRequest(modelForUse))
        });
        if (!res2.ok) {
          const txt2 = await res2.text();
          throw new Error(`Fallback Error: ${txt2}`);
        }
        const data2 = await res2.json();
        return data2.choices?.[0]?.message?.content.trim() || '(No Suggestion)';
      } else {
        throw err;
      }
    }
  };

  // ヘルパー: Originalテキスト表示用
  const getOriginalDisplayText = (originalText) => {
    const hasSingleDot = /(?:^|\s)\.(?:\s|$)/.test(originalText);
    if (originalText.includes('$') || hasSingleDot) {
      return '- - -';
    }
    return originalText;
  };

  // Original音声 再生
  const handlePlayClip = async (pin, index) => {
    if (!pin.analysis?.clipUri) {
      Alert.alert('No original audio file (clip)');
      return;
    }
    if (playingAudioIndex !== null && playingAudioIndex !== index) {
      Alert.alert('他のPINを再生中です');
      return;
    }
    if (playingAudioIndex === index) {
      await stopClip();
      return;
    }

    try {
      if (sound) {
        await sound.unloadAsync();
      }
      if (clipTimeoutRef.current) {
        clearTimeout(clipTimeoutRef.current);
        clipTimeoutRef.current = null;
      }

      const { sound: newSound } = await Audio.Sound.createAsync({
        uri: pin.analysis.clipUri
      });
      setSound(newSound);
      setPlayingAudioIndex(index);

      newSound.setOnPlaybackStatusUpdate((status) => {
        if (status.didJustFinish) {
          newSound.unloadAsync();
          setPlayingAudioIndex(null);
        }
      });

      await newSound.playAsync();
    } catch (err) {
      console.error('Play error:', err);
      setPlayingAudioIndex(null);
    }
  };

  // Original音声停止
  const stopClip = async () => {
    try {
      if (clipTimeoutRef.current) {
        clearTimeout(clipTimeoutRef.current);
        clipTimeoutRef.current = null;
      }
      if (sound) {
        const st = await sound.getStatusAsync();
        if (st.isPlaying) {
          await sound.stopAsync();
        }
        await sound.unloadAsync();
      }
      setPlayingAudioIndex(null);
    } catch (err) {
      console.error('Stop error:', err);
    }
  };

  // TTS再生
  const handlePlayTTS = async (pin, index) => {
    if (!pin.analysis?.suggestion) {
      Alert.alert('No suggestion text');
      return;
    }
    if (playingTtsIndex !== null && playingTtsIndex !== index) {
      Alert.alert('他のPINを再生中です');
      return;
    }
    if (playingAudioIndex !== null) {
      await stopClip();
    }

    if (playingTtsIndex === index) {
      Speech.stop();
      setPlayingTtsIndex(null);
      return;
    }

    setPlayingTtsIndex(index);
    Speech.speak(pin.analysis.suggestion, {
      language: 'en-US',
      onDone: () => setPlayingTtsIndex(null),
      onStopped: () => setPlayingTtsIndex(null),
      onError: () => setPlayingTtsIndex(null)
    });
  };

  // 分析完了 → ログ保存
  useEffect(() => {
    if (recordedURI && analysisDone) {
      const session = {
        sessionId: Date.now().toString(),
        date: new Date().toISOString(),
        filePath: recordedURI,
        pinned: pinnedMoments
      };
      saveSessionLog(session);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisDone]);

  const saveSessionLog = async (sessionData) => {
    const logsKey = 'SESSION_LOGS';
    const logsJson = await AsyncStorage.getItem(logsKey);
    const logs = logsJson ? JSON.parse(logsJson) : [];
    logs.push(sessionData);
    await AsyncStorage.setItem(logsKey, JSON.stringify(logs));
  };

  // reset
  const handleReset = async () => {
    await stopClip();
    Speech.stop();
    setPlayingTtsIndex(null);

    setRecording(null);
    setRecordedURI(null);
    setElapsedTime(0);
    setPinnedMoments([]);
    setAnalysisDone(false);
    setIsRecording(false);
    setPlayingAudioIndex(null);
    setPinCount(0);
    Alert.alert('Reset', 'Session reset done.');
  };

  // mm:ss
  const formatTime = (sec) => {
    if (sec < 0) sec = 0;
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  const renderPinTimeRange = (pinTimeSec) => {
    const fromSec = Math.max(0, pinTimeSec - 15);
    return `📍${formatTime(fromSec)} - ${formatTime(pinTimeSec)}`;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* PIN設定ポップアップ */}
      {pinNotificationVisible && (
        <View style={styles.pinPopupOverlay}>
          <View style={styles.pinPopupBox}>
            <Text style={styles.pinPopupText}>📍 Pinned #{pinCount}!!</Text>
          </View>
        </View>
      )}

      {/* Recording中は表示しない (!isRecording) */}
      {!isRecording && (
        <TouchableOpacity
          style={styles.historyFloatingBtn}
          onPress={() => navigation.navigate('History')}
          activeOpacity={0.8}
        >
          <Ionicons name="book" size={24} color="#fff" />
        </TouchableOpacity>
      )}

      <View style={styles.mainArea}>
        {/* 録音中 → 大きいタイマー */}
        {isRecording && (
          <Text style={styles.timerText}>{formatTime(elapsedTime)}</Text>
        )}

        {/* Idle → 録音ボタン */}
        {!isRecording && !recordedURI && (
          <TouchableOpacity
            style={styles.recordButton}
            onPress={startRecording}
            activeOpacity={0.8}
          >
            <Ionicons name="mic" size={40} color="#fff" />
          </TouchableOpacity>
        )}

        {/* 録音中 → STOP + PIN */}
        {isRecording && (
          <View style={styles.rowCenter}>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: STOP_RED }]}
              onPress={stopRecording}
              activeOpacity={0.8}
            >
              <Ionicons name="stop" size={34} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: DARK_BLUE }]}
              onPress={handlePin}
              activeOpacity={0.8}
            >
              <Text style={{ fontSize: 28, color: '#fff' }}>📍</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* STOP後 → PIN一覧 + NewRecord */}
        {recordedURI && !isRecording && (
          <View style={{ marginTop: 30, width: '100%' }}>
            {pinnedMoments.length > 0 && (
              <View style={styles.pinsContainer}>
                {pinnedMoments.map((pin, idx) => {
                  const isClipPlaying = playingAudioIndex === idx;
                  const isTtsPlaying = playingTtsIndex === idx;

                  return (
                    <View key={idx} style={styles.pinCard}>
                      <Text style={styles.pinLabel}>
                        {renderPinTimeRange(pin.pinTime)}
                      </Text>
                      {!pin.analysis ? (
                        <Text style={styles.noAnalysis}>
                          {trimming ? 'Analyzing...' : 'No analysis'}
                        </Text>
                      ) : (
                        <>
                          <Text style={styles.analysisText}>
                            Original: {getOriginalDisplayText(pin.analysis.original)}
                          </Text>
                          <Text style={styles.analysisText}>
                            AI Correction: {pin.analysis.suggestion}
                          </Text>

                          <View style={styles.actionsRow}>
                            {/* Original */}
                            {isClipPlaying ? (
                              <TouchableOpacity
                                style={[styles.smallBtn, styles.btnStopSmall]}
                                onPress={() => handlePlayClip(pin, idx)}
                                activeOpacity={0.8}
                              >
                                <Ionicons name="square-outline" size={16} color="#fff" />
                                <Text style={styles.smallBtnText}>Stop</Text>
                              </TouchableOpacity>
                            ) : (
                              <TouchableOpacity
                                style={[styles.smallBtn, styles.btnPlaySmall]}
                                onPress={() => handlePlayClip(pin, idx)}
                                activeOpacity={0.8}
                              >
                                <Ionicons name="play-circle" size={16} color="#fff" />
                                <Text style={styles.smallBtnText}>Play</Text>
                              </TouchableOpacity>
                            )}

                            {/* TTS */}
                            {isTtsPlaying ? (
                              <TouchableOpacity
                                style={[styles.smallBtn, styles.btnTtsSmall]}
                                onPress={() => handlePlayTTS(pin, idx)}
                                activeOpacity={0.8}
                              >
                                <Ionicons name="square-outline" size={16} color="#fff" />
                                <Text style={styles.smallBtnText}>Stop</Text>
                              </TouchableOpacity>
                            ) : (
                              <TouchableOpacity
                                style={[styles.smallBtn, styles.btnTtsSmall]}
                                onPress={() => handlePlayTTS(pin, idx)}
                                activeOpacity={0.8}
                              >
                                <Ionicons name="volume-high-outline" size={16} color="#fff" />
                                <Text style={styles.smallBtnText}>AI Correction</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            {/* New Record */}
            <View style={{ alignItems: 'center', marginTop: 20 }}>
              <TouchableOpacity
                style={[styles.recordButton, { backgroundColor: DARK_BLUE }]}
                onPress={handleReset}
                activeOpacity={0.8}
              >
                <Ionicons name="refresh" size={36} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.newRecordText}>New Record</Text>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

// --- スタイル ---
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f5f6fa',
    position: 'relative'
  },
  mainArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16
  },
  // PINポップアップ
  pinPopupOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999
  },
  pinPopupBox: {
    backgroundColor: '#fff',
    borderRadius: 24,
    paddingVertical: 20,
    paddingHorizontal: 36,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 6
  },
  pinPopupText: {
    fontSize: 24,
    fontWeight: '700',
    color: DARK_BLUE
  },
  // 履歴ボタン
  historyFloatingBtn: {
    position: 'absolute',
    bottom: 30,
    right: 20,
    backgroundColor: HISTORY_COLOR,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3
  },
  // タイマー
  timerText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: STOP_RED,
    marginBottom: 40
  },
  recordButton: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: STOP_RED,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#333',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 5,
    elevation: 4
  },
  rowCenter: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  actionButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#333',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 5,
    elevation: 4
  },
  // PIN一覧
  pinsContainer: {
    width: '100%'
  },
  pinCard: {
    backgroundColor: PIN_BG,
    borderWidth: 1,
    borderColor: '#d2e8dc',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10
  },
  pinLabel: {
    fontSize: 15,
    fontWeight: 'bold',
    color: DARK_BLUE,
    marginBottom: 6
  },
  noAnalysis: {
    fontSize: 14,
    color: '#bdc3c7',
    fontStyle: 'italic',
    marginBottom: 4
  },
  analysisText: {
    fontSize: 14,
    color: DARK_BLUE,
    marginBottom: 4
  },
  actionsRow: {
    flexDirection: 'row',
    marginTop: 5
  },
  smallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 10
  },
  smallBtnText: {
    marginLeft: 4,
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold'
  },
  btnStopSmall: { backgroundColor: STOP_RED },
  btnPlaySmall: { backgroundColor: DARK_BLUE },
  btnTtsSmall: { backgroundColor: ACCENT_ORANGE },
  newRecordText: {
    marginTop: 8,
    fontSize: 14,
    color: DARK_BLUE,
    fontWeight: 'bold'
  }
});
