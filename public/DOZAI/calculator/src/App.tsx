import React, { useState } from 'react';

function App() {
  const [currentInput, setCurrentInput] = useState('0');
  const [previousInput, setPreviousInput] = useState('');
  const [operation, setOperation] = useState('');
  const [shouldResetDisplay, setShouldResetDisplay] = useState(false);

  const clearAll = () => {
    setCurrentInput('0');
    setPreviousInput('');
    setOperation('');
    setShouldResetDisplay(false);
  };

  const deleteLast = () => {
    if (currentInput.length > 1) {
      setCurrentInput(currentInput.slice(0, -1));
    } else {
      setCurrentInput('0');
    }
  };

  const appendNumber = (num: string) => {
    if (shouldResetDisplay) {
      setCurrentInput(num);
      setShouldResetDisplay(false);
    } else if (currentInput === '0') {
      setCurrentInput(num);
    } else if (currentInput.length < 12) {
      setCurrentInput(currentInput + num);
    }
  };

  const appendDecimal = () => {
    if (shouldResetDisplay) {
      setCurrentInput('0.');
      setShouldResetDisplay(false);
    } else if (!currentInput.includes('.')) {
      setCurrentInput(currentInput + '.');
    }
  };

  const chooseOperation = (op: string) => {
    if (operation && !shouldResetDisplay) {
      calculate();
      return;
    }
    
    setPreviousInput(currentInput);
    setOperation(op);
    setShouldResetDisplay(true);
  };

  const calculate = () => {
    if (!operation || !previousInput) return;

    const prev = parseFloat(previousInput);
    const current = parseFloat(currentInput);
    let result: number;

    switch (operation) {
      case '+':
        result = prev + current;
        break;
      case '-':
        result = prev - current;
        break;
      case '×':
        result = prev * current;
        break;
      case '÷':
        if (current === 0) {
          setCurrentInput('Error');
          setPreviousInput('');
          setOperation('');
          setShouldResetDisplay(true);
          return;
        }
        result = prev / current;
        break;
      default:
        return;
    }

    const resultString = result.toString();
    if (resultString.length > 12) {
      setCurrentInput(result.toPrecision(10));
    } else {
      setCurrentInput(resultString);
    }
    
    setOperation('');
    setPreviousInput('');
    setShouldResetDisplay(true);
  };

  const getDisplayClass = () => {
    return currentInput.length > 8 ? 'display small' : 'display';
  };

  return (
    <div className="calculator">
      <div className={getDisplayClass()}>{currentInput}</div>
      <div className="buttons">
        <button className="clear" onClick={clearAll}>AC</button>
        <button className="clear" onClick={deleteLast}>DEL</button>
        <button className="operator" onClick={() => chooseOperation('÷')}>÷</button>
        <button className="operator" onClick={() => chooseOperation('×')}>×</button>
        
        <button onClick={() => appendNumber('7')}>7</button>
        <button onClick={() => appendNumber('8')}>8</button>
        <button onClick={() => appendNumber('9')}>9</button>
        <button className="operator" onClick={() => chooseOperation('-')}>-</button>
        
        <button onClick={() => appendNumber('4')}>4</button>
        <button onClick={() => appendNumber('5')}>5</button>
        <button onClick={() => appendNumber('6')}>6</button>
        <button className="operator" onClick={() => chooseOperation('+')}>+</button>
        
        <button onClick={() => appendNumber('1')}>1</button>
        <button onClick={() => appendNumber('2')}>2</button>
        <button onClick={() => appendNumber('3')}>3</button>
        <button className="equals" onClick={calculate}>=</button>
        
        <button className="zero" onClick={() => appendNumber('0')}>0</button>
        <button onClick={appendDecimal}>.</button>
      </div>
    </div>
  );
}

export default App;
