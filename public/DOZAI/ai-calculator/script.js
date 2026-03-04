class AICalculator {
    constructor() {
        this.currentInput = '0';
        this.expression = '';
        this.shouldResetDisplay = false;
        this.history = [];
        this.steps = [];
        this.lastWasOperator = false;
        
        this.initializeElements();
        this.bindEvents();
        this.loadHistory();
        this.updateDisplay();
    }

    initializeElements() {
        this.displayExpression = document.getElementById('displayExpression');
        this.displayResult = document.getElementById('displayResult');
        this.aiInput = document.getElementById('aiInput');
        this.historyPanel = document.getElementById('historyPanel');
        this.stepsPanel = document.getElementById('stepsPanel');
        this.historyCount = document.getElementById('historyCount');
        this.stepsCount = document.getElementById('stepsCount');
    }

    bindEvents() {
        // Button clicks
        document.querySelectorAll('.btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const action = e.target.dataset.action;
                const value = e.target.dataset.value;
                
                if (action) {
                    this.handleAction(action, value);
                }
            });
        });

        // AI input
        const aiForm = document.getElementById('aiForm');
        aiForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.processAIInput();
        });

        // Keyboard support
        document.addEventListener('keydown', (e) => {
            this.handleKeyboard(e);
        });

        // Clear buttons
        document.getElementById('clearHistoryBtn').addEventListener('click', () => {
            this.clearHistory();
        });

        document.getElementById('clearStepsBtn').addEventListener('click', () => {
            this.clearSteps();
        });
    }

    handleAction(action, value) {
        switch (action) {
            case 'number':
                this.appendNumber(value);
                break;
            case 'operator':
                this.appendOperator(value);
                break;
            case 'decimal':
                this.appendDecimal();
                break;
            case 'clear':
                this.clearAll();
                break;
            case 'clear-entry':
                this.clearEntry();
                break;
            case 'equals':
                this.calculate();
                break;
            case 'function':
                this.applyFunction(value);
                break;
            case 'constant':
                this.insertConstant(value);
                break;
            case 'parenthesis':
                this.appendParenthesis(value);
                break;
        }
    }

    appendNumber(num) {
        if (this.shouldResetDisplay) {
            this.currentInput = '0';
            this.shouldResetDisplay = false;
        }

        if (this.currentInput === '0') {
            this.currentInput = num;
        } else {
            this.currentInput += num;
        }
        
        this.lastWasOperator = false;
        this.updateDisplay();
    }

    appendOperator(op) {
        if (this.currentInput === '' && this.expression === '') return;

        if (this.lastWasOperator) {
            // Replace last operator
            this.expression = this.expression.slice(0, -1) + op;
        } else {
            if (this.currentInput !== '') {
                this.expression += this.currentInput + op;
            } else if (this.expression !== '') {
                this.expression = this.expression.slice(0, -1) + op;
            }
        }

        this.currentInput = '';
        this.lastWasOperator = true;
        this.shouldResetDisplay = false;
        this.updateDisplay();
    }

    appendDecimal() {
        if (this.shouldResetDisplay) {
            this.currentInput = '0';
            this.shouldResetDisplay = false;
        }

        if (!this.currentInput.includes('.')) {
            this.currentInput += '.';
            this.updateDisplay();
        }
    }

    appendParenthesis(paren) {
        if (this.shouldResetDisplay) {
            this.currentInput = '';
            this.shouldResetDisplay = false;
        }

        if (paren === '(') {
            if (this.currentInput !== '' && !this.lastWasOperator) {
                this.expression += this.currentInput + '×(';
            } else {
                this.expression += '(';
            }
            this.currentInput = '';
        } else if (paren === ')') {
            if (this.currentInput !== '') {
                this.expression += this.currentInput + ')';
                this.currentInput = '';
            } else if (this.expression !== '') {
                this.expression += ')';
            }
        }
        
        this.lastWasOperator = false;
        this.updateDisplay();
    }

    insertConstant(constant) {
        const constants = {
            'pi': Math.PI.toString(),
            'e': Math.E.toString()
        };
        
        if (constants[constant]) {
            this.currentInput = constants[constant];
            this.shouldResetDisplay = false;
            this.lastWasOperator = false;
            this.updateDisplay();
        }
    }

    applyFunction(func) {
        if (this.currentInput === '') return;

        try {
            const value = parseFloat(this.currentInput);
            let result;
            let steps = [];

            switch (func) {
                case 'sin':
                    result = Math.sin(this.toRadians(value));
                    steps.push(`sin(${value}°) = sin(${this.toRadians(value)}) = ${result}`);
                    break;
                case 'cos':
                    result = Math.cos(this.toRadians(value));
                    steps.push(`cos(${value}°) = cos(${this.toRadians(value)}) = ${result}`);
                    break;
                case 'tan':
                    result = Math.tan(this.toRadians(value));
                    steps.push(`tan(${value}°) = tan(${this.toRadians(value)}) = ${result}`);
                    break;
                case 'asin':
                    result = this.toDegrees(Math.asin(value));
                    steps.push(`asin(${value}) = ${result}°`);
                    break;
                case 'acos':
                    result = this.toDegrees(Math.acos(value));
                    steps.push(`acos(${value}) = ${result}°`);
                    break;
                case 'atan':
                    result = this.toDegrees(Math.atan(value));
                    steps.push(`atan(${value}) = ${result}°`);
                    break;
                case 'sinh':
                    result = Math.sinh(value);
                    steps.push(`sinh(${value}) = ${result}`);
                    break;
                case 'cosh':
                    result = Math.cosh(value);
                    steps.push(`cosh(${value}) = ${result}`);
                    break;
                case 'tanh':
                    result = Math.tanh(value);
                    steps.push(`tanh(${value}) = ${result}`);
                    break;
                case 'log':
                    result = Math.log10(value);
                    steps.push(`log(${value}) = ${result}`);
                    break;
                case 'ln':
                    result = Math.log(value);
                    steps.push(`ln(${value}) = ${result}`);
                    break;
                case 'sqrt':
                    result = Math.sqrt(value);
                    steps.push(`√(${value}) = ${result}`);
                    break;
                case 'cbrt':
                    result = Math.cbrt(value);
                    steps.push(`∛(${value}) = ${result}`);
                    break;
                case 'abs':
                    result = Math.abs(value);
                    steps.push(`|${value}| = ${result}`);
                    break;
                case 'floor':
                    result = Math.floor(value);
                    steps.push(`floor(${value}) = ${result}`);
                    break;
                case 'ceil':
                    result = Math.ceil(value);
                    steps.push(`ceil(${value}) = ${result}`);
                    break;
                case 'round':
                    result = Math.round(value);
                    steps.push(`round(${value}) = ${result}`);
                    break;
                case 'factorial':
                    result = this.factorial(value);
                    steps.push(`${value}! = ${result}`);
                    break;
            }

            this.currentInput = result.toString();
            this.shouldResetDisplay = true;
            this.addSteps(steps);
            this.updateDisplay();
        } catch (error) {
            this.showError('Invalid input for function');
        }
    }

    factorial(n) {
        if (n < 0 || !Number.isInteger(n)) throw new Error('Invalid factorial');
        if (n === 0 || n === 1) return 1;
        
        let result = 1;
        let steps = [];
        
        for (let i = 2; i <= n; i++) {
            result *= i;
            steps.push(`${i} × ${result / i} = ${result}`);
        }
        
        this.addSteps([`${n}! = ${steps.map(s => s.split(' ')[0]).join(' × ')} = ${result}`]);
        return result;
    }

    toRadians(degrees) {
        return degrees * (Math.PI / 180);
    }

    toDegrees(radians) {
        return radians * (180 / Math.PI);
    }

    calculate() {
        if (this.currentInput === '' && this.expression === '') return;

        try {
            let fullExpression = this.expression;
            if (this.currentInput !== '') {
                fullExpression += this.currentInput;
            }

            if (fullExpression === '') return;

            // Replace symbols for evaluation
            let evalExpression = fullExpression
                .replace(/×/g, '*')
                .replace(/÷/g, '/')
                .replace(/−/g, '-')
                .replace(/\^/g, '**');

            // Generate steps
            this.generateSteps(evalExpression);

            // Evaluate safely
            const result = this.safeEvaluate(evalExpression);
            
            if (isNaN(result) || !isFinite(result)) {
                throw new Error('Invalid result');
            }

            // Add to history
            this.addToHistory(fullExpression, result);
            
            // Update display
            this.currentInput = result.toString();
            this.expression = '';
            this.shouldResetDisplay = true;
            this.lastWasOperator = false;
            this.updateDisplay();

        } catch (error) {
            this.showError('Invalid expression');
        }
    }

    safeEvaluate(expression) {
        // Use Function constructor for safer evaluation than eval
        const func = new Function('return ' + expression);
        const result = func();
        
        // Round if very close to integer
        if (Math.abs(result - Math.round(result)) < 1e-10) {
            return Math.round(result);
        }
        
        return result;
    }

    generateSteps(expression) {
        this.steps = [];
        
        // Simple step generation for basic operations
        try {
            // Handle parentheses first
            const parenRegex = /\(([^()]+)\)/g;
            let match;
            let steps = [];
            
            while ((match = parenRegex.exec(expression)) !== null) {
                const subResult = this.safeEvaluate(match[1]);
                steps.push(`(${match[1]}) = ${subResult}`);
            }
            
            if (steps.length > 0) {
                this.addSteps(steps);
            }
        } catch (e) {
            // Silent fail for step generation
        }
    }

    processAIInput() {
        const input = this.aiInput.value.trim();
        if (!input) return;

        // Show loading state
        const originalPlaceholder = this.aiInput.placeholder;
        this.aiInput.placeholder = 'Processing...';
        this.aiInput.disabled = true;

        setTimeout(() => {
            try {
                const result = this.parseNaturalLanguage(input);
                if (result !== null) {
                    this.aiInput.value = '';
                    this.currentInput = result.toString();
                    this.expression = '';
                    this.shouldResetDisplay = true;
                    this.updateDisplay();
                } else {
                    this.showError('Could not understand expression');
                }
            } catch (error) {
                this.showError('AI processing failed');
            } finally {
                this.aiInput.placeholder = originalPlaceholder;
                this.aiInput.disabled = false;
                this.aiInput.focus();
            }
        }, 500);
    }

    parseNaturalLanguage(text) {
        // Convert natural language to mathematical expression
        let expression = text.toLowerCase();
        
        // Replace words with operators
        const replacements = {
            'plus': '+',
            'add': '+',
            'minus': '-',
            'subtract': '-',
            'times': '*',
            'multiplied by': '*',
            'divide by': '/',
            'divided by': '/',
            'over': '/',
            'to the power of': '**',
            'squared': '**2',
            'cubed': '**3',
            'square root of': 'Math.sqrt(',
            'cube root of': 'Math.cbrt(',
            'factorial': '!',
            'pi': Math.PI,
            'e': Math.E
        };

        for (const [word, symbol] of Object.entries(replacements)) {
            expression = expression.replace(new RegExp(word, 'g'), symbol);
        }

        // Close any open parentheses from sqrt/cbrt
        const openParens = (expression.match(/Math\.(sqrt|cbrt)\(/g) || []).length;
        const closeParens = (expression.match(/\)/g) || []).length;
        if (openParens > closeParens) {
            expression += ')'.repeat(openParens - closeParens);
        }

        // Extract numbers and operators
        try {
            // Simple evaluation for basic arithmetic
            const result = this.safeEvaluate(expression);
            this.addSteps([`${text} = ${expression} = ${result}`]);
            return result;
        } catch (e) {
            return null;
        }
    }

    handleKeyboard(e) {
        if (this.aiInput === document.activeElement) return;

        const key = e.key;

        if (key >= '0' && key <= '9') {
            this.appendNumber(key);
        } else if (key === '.') {
            this.appendDecimal();
        } else if (key === '+' || key === '-' || key === '*' || key === '/') {
            this.appendOperator(key);
        } else if (key === 'Enter' || key === '=') {
            this.calculate();
        } else if (key === 'Escape' || key === 'c' || key === 'C') {
            this.clearAll();
        } else if (key === 'Backspace') {
            this.backspace();
        }
    }

    backspace() {
        if (this.currentInput.length > 1) {
            this.currentInput = this.currentInput.slice(0, -1);
        } else {
            this.currentInput = '0';
        }
        this.updateDisplay();
    }

    clearAll() {
        this.currentInput = '0';
        this.expression = '';
        this.shouldResetDisplay = false;
        this.lastWasOperator = false;
        this.updateDisplay();
    }

    clearEntry() {
        this.currentInput = '0';
        this.updateDisplay();
    }

    showError(message) {
        this.displayResult.textContent = 'Error';
        this.displayExpression.textContent = message;
        
        setTimeout(() => {
            this.updateDisplay();
        }, 2000);
    }

    updateDisplay() {
        // Update main display
        this.displayResult.textContent = this.currentInput;
        
        let expressionText = this.expression;
        if (this.currentInput !== '' && this.currentInput !== '0') {
            expressionText += this.currentInput;
        }
        
        // Clean up display
        expressionText = expressionText
            .replace(/\*/g, '×')
            .replace(/\//g, '÷')
            .replace(/\-/g, '−')
            .replace(/\*\*/g, '^');
            
        this.displayExpression.textContent = expressionText || '';

        // Update panels
        this.renderHistory();
        this.renderSteps();
    }

    addToHistory(expression, result) {
        const item = {
            id: Date.now(),
            expression: expression.replace(/\*/g, '×').replace(/\//g, '÷').replace(/\-/g, '−'),
            result: result,
            timestamp: new Date().toLocaleTimeString()
        };

        this.history.unshift(item);
        if (this.history.length > 50) {
            this.history.pop();
        }

        this.saveHistory();
        this.renderHistory();
    }

    renderHistory() {
        if (this.history.length === 0) {
            this.historyPanel.innerHTML = '<div class="empty-state">No calculations yet</div>';
            this.historyCount.textContent = '(0)';
            return;
        }

        this.historyPanel.innerHTML = this.history.map(item => `
            <div class="history-item" data-id="${item.id}">
                <div class="expression">${item.expression}</div>
                <div class="result">= ${this.formatNumber(item.result)}</div>
            </div>
        `).join('');

        this.historyCount.textContent = `(${this.history.length})`;

        // Add click handlers
        this.historyPanel.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = parseInt(item.dataset.id);
                const historyItem = this.history.find(h => h.id === id);
                if (historyItem) {
                    this.currentInput = historyItem.result.toString();
                    this.expression = '';
                    this.shouldResetDisplay = true;
                    this.updateDisplay();
                }
            });
        });
    }

    addSteps(steps) {
        steps.forEach(step => {
            this.steps.unshift({
                id: Date.now() + Math.random(),
                text: step,
                timestamp: new Date().toLocaleTimeString()
            });
        });

        if (this.steps.length > 100) {
            this.steps = this.steps.slice(0, 100);
        }

        this.renderSteps();
    }

    renderSteps() {
        if (this.steps.length === 0) {
            this.stepsPanel.innerHTML = '<div class="empty-state">No steps to show</div>';
            this.stepsCount.textContent = '(0)';
            return;
        }

        this.stepsPanel.innerHTML = this.steps.map(step => `
            <div class="step-item">
                ${step.text}
            </div>
        `).join('');

        this.stepsCount.textContent = `(${this.steps.length})`;
    }

    clearHistory() {
        this.history = [];
        this.saveHistory();
        this.renderHistory();
    }

    clearSteps() {
        this.steps = [];
        this.renderSteps();
    }

    saveHistory() {
        try {
            localStorage.setItem('ai-calculator-history', JSON.stringify(this.history));
        } catch (e) {
            // Ignore storage errors
        }
    }

    loadHistory() {
        try {
            const saved = localStorage.getItem('ai-calculator-history');
            if (saved) {
                this.history = JSON.parse(saved);
            }
        } catch (e) {
            this.history = [];
        }
    }

    formatNumber(num) {
        if (Math.abs(num) > 1e12 || (Math.abs(num) < 1e-6 && num !== 0)) {
            return num.toExponential(6);
        }
        
        const str = num.toString();
        if (str.length > 15) {
            return num.toFixed(10).replace(/\.?0+$/, '');
        }
        
        return str;
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new AICalculator();
    });
} else {
    new AICalculator();
}