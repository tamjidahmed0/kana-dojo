'use client';
import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import { kana } from '@/features/Kana/data/kana';
import useKanaStore from '@/features/Kana/store/useKanaStore';
import { CircleCheck, CircleX, RotateCcw } from 'lucide-react';
import { Random } from 'random-js';
import { useCorrect, useError } from '@/shared/hooks/useAudio';
import GameIntel from '@/shared/components/Game/GameIntel';
import { getGlobalAdaptiveSelector } from '@/shared/lib/adaptiveSelection';
import Stars from '@/shared/components/Game/Stars';
import { useCrazyModeTrigger } from '@/features/CrazyMode/hooks/useCrazyModeTrigger';
import useStatsStore from '@/features/Progress/store/useStatsStore';
import { useShallow } from 'zustand/react/shallow';
import useStats from '@/shared/hooks/useStats';

const random = new Random();
const adaptiveSelector = getGlobalAdaptiveSelector();

// Duolingo-like spring animation config
const springConfig = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 30,
  mass: 0.8
};

const tileHoverScale = 1.05;
const tileTapScale = 0.95;

// Helper function to determine if a kana character is hiragana or katakana
const isHiragana = (char: string): boolean => {
  const code = char.charCodeAt(0);
  return code >= 0x3040 && code <= 0x309f;
};

const isKatakana = (char: string): boolean => {
  const code = char.charCodeAt(0);
  return code >= 0x30a0 && code <= 0x30ff;
};

interface TileProps {
  id: string;
  char: string;
  onClick: () => void;
  isPlaced?: boolean;
  isDisabled?: boolean;
  index?: number;
}

// Memoized tile component for smooth animations
const Tile = memo(
  ({ id, char, onClick, isPlaced, isDisabled, index }: TileProps) => {
    return (
      <motion.button
        layoutId={id}
        type='button'
        onClick={onClick}
        disabled={isDisabled}
        className={clsx(
          'relative flex items-center justify-center rounded-2xl px-4 py-3 text-2xl font-semibold transition-colors sm:px-6 sm:py-4 sm:text-3xl',
          'border-b-4 active:translate-y-[4px] active:border-b-0',
          isPlaced
            ? 'border-[var(--secondary-color-accent)] bg-[var(--secondary-color)] text-[var(--background-color)]'
            : 'border-[var(--main-color-accent)] bg-[var(--main-color)] text-[var(--background-color)]',
          isDisabled && 'cursor-not-allowed opacity-50'
        )}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        whileHover={!isDisabled ? { scale: tileHoverScale } : undefined}
        whileTap={!isDisabled ? { scale: tileTapScale } : undefined}
        transition={springConfig}
      >
        {char}
        {/* Keyboard hint */}
        {!isPlaced && index !== undefined && (
          <span
            className={clsx(
              'absolute top-1/2 right-2 hidden h-5 min-w-5 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--border-color)] px-1 text-xs leading-none lg:inline-flex',
              'text-[var(--main-color)]'
            )}
          >
            {index + 1}
          </span>
        )}
      </motion.button>
    );
  }
);

Tile.displayName = 'Tile';

// Empty slot placeholder
const EmptySlot = memo(({ index }: { index: number }) => (
  <motion.div
    key={`slot-empty-${index}`}
    className='flex h-14 w-16 items-center justify-center rounded-2xl border-2 border-dashed border-[var(--border-color)] sm:h-16 sm:w-20'
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ delay: index * 0.05 }}
  />
));

EmptySlot.displayName = 'EmptySlot';

interface WordBuildingGameProps {
  isHidden: boolean;
  isReverse: boolean; // true = romaji display, kana tiles; false = kana display, romaji tiles
  wordLength: number;
  onCorrect: (chars: string[]) => void;
  onWrong: () => void;
}

const WordBuildingGame = ({
  isHidden,
  isReverse,
  wordLength,
  onCorrect,
  onWrong
}: WordBuildingGameProps) => {
  const { playCorrect } = useCorrect();
  const { playErrorTwice } = useError();
  const { trigger: triggerCrazyMode } = useCrazyModeTrigger();

  const {
    score,
    setScore,
    incrementHiraganaCorrect,
    incrementKatakanaCorrect,
    incrementWrongStreak,
    resetWrongStreak
  } = useStatsStore(
    useShallow(state => ({
      score: state.score,
      setScore: state.setScore,
      incrementHiraganaCorrect: state.incrementHiraganaCorrect,
      incrementKatakanaCorrect: state.incrementKatakanaCorrect,
      incrementWrongStreak: state.incrementWrongStreak,
      resetWrongStreak: state.resetWrongStreak
    }))
  );

  const {
    incrementCorrectAnswers,
    incrementWrongAnswers,
    addCharacterToHistory,
    incrementCharacterScore
  } = useStats();

  const kanaGroupIndices = useKanaStore(state => state.kanaGroupIndices);

  // Get all available kana and romaji from selected groups
  const { selectedKana, selectedRomaji, kanaToRomaji, romajiToKana } =
    useMemo(() => {
      const kanaChars = kanaGroupIndices.map(i => kana[i].kana).flat();
      const romajiChars = kanaGroupIndices.map(i => kana[i].romanji).flat();

      const k2r: Record<string, string> = {};
      const r2k: Record<string, string> = {};

      kanaChars.forEach((k, i) => {
        k2r[k] = romajiChars[i];
        r2k[romajiChars[i]] = k;
      });

      return {
        selectedKana: kanaChars,
        selectedRomaji: romajiChars,
        kanaToRomaji: k2r,
        romajiToKana: r2k
      };
    }, [kanaGroupIndices]);

  const [feedback, setFeedback] = useState(<>{'Build the word!'}</>);

  // Generate a word (array of characters) and distractors
  const generateWord = useCallback(() => {
    const sourceChars = isReverse ? selectedRomaji : selectedKana;
    if (sourceChars.length < wordLength) {
      return { wordChars: [], answerChars: [], allTiles: [] };
    }

    // Select characters for the word using adaptive selection
    const wordChars: string[] = [];
    const usedChars = new Set<string>();

    for (let i = 0; i < wordLength; i++) {
      const available = sourceChars.filter(c => !usedChars.has(c));
      if (available.length === 0) break;

      const selected = adaptiveSelector.selectWeightedCharacter(available);
      wordChars.push(selected);
      usedChars.add(selected);
      adaptiveSelector.markCharacterSeen(selected);
    }

    // Get the answer characters (the tiles user needs to select)
    const answerChars = isReverse
      ? wordChars.map(r => romajiToKana[r])
      : wordChars.map(k => kanaToRomaji[k]);

    // Generate distractor tiles (extra incorrect options)
    const distractorCount = Math.min(3, sourceChars.length - wordLength);
    const distractorSource = isReverse ? selectedKana : selectedRomaji;
    const distractors: string[] = [];
    const usedAnswers = new Set(answerChars);

    for (let i = 0; i < distractorCount; i++) {
      const available = distractorSource.filter(
        c => !usedAnswers.has(c) && !distractors.includes(c)
      );
      if (available.length === 0) break;
      const selected = available[random.integer(0, available.length - 1)];
      distractors.push(selected);
    }

    // Combine and shuffle all tiles
    const allTiles = [...answerChars, ...distractors].sort(
      () => random.real(0, 1) - 0.5
    );

    return { wordChars, answerChars, allTiles };
  }, [
    isReverse,
    selectedKana,
    selectedRomaji,
    wordLength,
    kanaToRomaji,
    romajiToKana
  ]);

  // Current word state
  const [wordData, setWordData] = useState(() => generateWord());
  const [placedTiles, setPlacedTiles] = useState<string[]>([]);
  const [isChecking, setIsChecking] = useState(false);

  // Reset the game with a new word
  const resetGame = useCallback(() => {
    const newWord = generateWord();
    setWordData(newWord);
    setPlacedTiles([]);
    setIsChecking(false);
    setFeedback(<>{'Build the word!'}</>);
  }, [generateWord]);

  // Regenerate word when direction or length changes
  useEffect(() => {
    resetGame();
  }, [isReverse, wordLength, resetGame]);

  // Check if answer is correct when all slots are filled
  useEffect(() => {
    if (
      placedTiles.length === wordData.wordChars.length &&
      wordData.wordChars.length > 0 &&
      !isChecking
    ) {
      setIsChecking(true);

      // Check if placed tiles match the answer in order
      const isCorrect = placedTiles.every(
        (tile, i) => tile === wordData.answerChars[i]
      );

      if (isCorrect) {
        playCorrect();
        triggerCrazyMode();
        resetWrongStreak();

        // Track stats for each character
        wordData.wordChars.forEach(char => {
          addCharacterToHistory(char);
          incrementCharacterScore(char, 'correct');
          adaptiveSelector.updateCharacterWeight(char, true);

          // Track content-specific stats
          if (isHiragana(char)) {
            incrementHiraganaCorrect();
          } else if (isKatakana(char)) {
            incrementKatakanaCorrect();
          }
        });

        incrementCorrectAnswers();
        setScore(score + wordData.wordChars.length);

        setFeedback(
          <>
            <span>
              {wordData.wordChars.join('')} = {wordData.answerChars.join('')}
            </span>
            <CircleCheck className='ml-2 inline text-[var(--main-color)]' />
          </>
        );

        // Notify parent and generate new word after delay
        setTimeout(() => {
          onCorrect(wordData.wordChars);
          resetGame();
        }, 800);
      } else {
        playErrorTwice();
        triggerCrazyMode();
        incrementWrongStreak();
        incrementWrongAnswers();

        // Track wrong for each character
        wordData.wordChars.forEach(char => {
          incrementCharacterScore(char, 'wrong');
          adaptiveSelector.updateCharacterWeight(char, false);
        });

        if (score - 1 >= 0) {
          setScore(score - 1);
        }

        setFeedback(
          <>
            <span>Wrong order! Try again</span>
            <CircleX className='ml-2 inline text-[var(--main-color)]' />
          </>
        );

        onWrong();

        // Clear placed tiles after shake animation
        setTimeout(() => {
          setPlacedTiles([]);
          setIsChecking(false);
        }, 600);
      }
    }
  }, [
    placedTiles,
    wordData,
    isChecking,
    playCorrect,
    playErrorTwice,
    triggerCrazyMode,
    resetWrongStreak,
    incrementWrongStreak,
    addCharacterToHistory,
    incrementCharacterScore,
    incrementHiraganaCorrect,
    incrementKatakanaCorrect,
    incrementCorrectAnswers,
    incrementWrongAnswers,
    score,
    setScore,
    onCorrect,
    onWrong,
    resetGame
  ]);

  // Handle tile click - either place or remove
  const handleTileClick = useCallback(
    (char: string) => {
      if (isChecking) return;

      if (placedTiles.includes(char)) {
        // Remove from placed tiles (clicks on placed tile)
        setPlacedTiles(prev => prev.filter(c => c !== char));
      } else if (placedTiles.length < wordData.wordChars.length) {
        // Add to placed tiles
        setPlacedTiles(prev => [...prev, char]);
      }
    },
    [isChecking, placedTiles, wordData.wordChars.length]
  );

  // Handle reset button
  const handleReset = useCallback(() => {
    if (!isChecking) {
      setPlacedTiles([]);
    }
  }, [isChecking]);

  // Not enough characters for word building
  if (selectedKana.length < wordLength || wordData.wordChars.length === 0) {
    return null;
  }

  // Get tiles that are not yet placed
  const availableTiles = wordData.allTiles.filter(
    t => !placedTiles.includes(t)
  );

  return (
    <div
      className={clsx(
        'flex w-full flex-col items-center gap-6 sm:w-4/5 sm:gap-10',
        isHidden && 'hidden'
      )}
    >
      <GameIntel gameMode='word-building' feedback={feedback} />

      {/* Word Display */}
      <div className='flex flex-row items-center gap-2'>
        <motion.p
          className='text-6xl font-medium tracking-wider sm:text-8xl'
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          key={wordData.wordChars.join('')}
        >
          {wordData.wordChars.join('')}
        </motion.p>
      </div>

      {/* Answer Slots Area */}
      <div className='flex flex-col items-center gap-4'>
        <div className='flex flex-row flex-wrap justify-center gap-3'>
          <AnimatePresence mode='popLayout'>
            {wordData.answerChars.map((_, index) => {
              const placedChar = placedTiles[index];
              if (placedChar) {
                return (
                  <Tile
                    key={`placed-${index}-${placedChar}`}
                    id={`tile-${placedChar}`}
                    char={placedChar}
                    onClick={() => handleTileClick(placedChar)}
                    isPlaced
                    isDisabled={isChecking}
                  />
                );
              }
              return <EmptySlot key={`slot-${index}`} index={index} />;
            })}
          </AnimatePresence>
        </div>

        {/* Reset button */}
        {placedTiles.length > 0 && !isChecking && (
          <motion.button
            type='button'
            onClick={handleReset}
            className='flex items-center gap-2 text-sm text-[var(--text-secondary-color)] transition-colors hover:text-[var(--text-color)]'
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <RotateCcw className='h-4 w-4' />
            Reset
          </motion.button>
        )}
      </div>

      {/* Available Tiles */}
      <div className='flex flex-row flex-wrap justify-center gap-3 sm:gap-4'>
        <AnimatePresence mode='popLayout'>
          {availableTiles.map((char, index) => (
            <Tile
              key={`tile-${char}`}
              id={`tile-${char}`}
              char={char}
              onClick={() => handleTileClick(char)}
              isDisabled={isChecking}
              index={index}
            />
          ))}
        </AnimatePresence>
      </div>

      <Stars />
    </div>
  );
};

export default WordBuildingGame;
