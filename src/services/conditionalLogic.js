class ConditionalLogicEngine {
  constructor() {
    this.operators = {
      equals: (actual, expected) => actual == expected,
      notEquals: (actual, expected) => actual != expected,
      contains: (actual, expected) => {
        if (Array.isArray(actual)) {
          return actual.includes(expected);
        }
        if (typeof actual === 'string') {
          return actual.includes(expected);
        }
        return false;
      },
      notContains: (actual, expected) => {
        if (Array.isArray(actual)) {
          return !actual.includes(expected);
        }
        if (typeof actual === 'string') {
          return !actual.includes(expected);
        }
        return true;
      },
      greaterThan: (actual, expected) => {
        const numActual = parseFloat(actual);
        const numExpected = parseFloat(expected);
        return !isNaN(numActual) && !isNaN(numExpected) && numActual > numExpected;
      },
      lessThan: (actual, expected) => {
        const numActual = parseFloat(actual);
        const numExpected = parseFloat(expected);
        return !isNaN(numActual) && !isNaN(numExpected) && numActual < numExpected;
      }
    };
  }

  /**
   * Evaluate if a question should be shown based on conditional rules
   * @param {Object} rules - Conditional rules object
   * @param {Object} answers - Current answers object
   * @returns {boolean} - Whether the question should be shown
   */
  shouldShowQuestion(rules, answers) {
    // If no rules, always show
    if (!rules || !rules.conditions || rules.conditions.length === 0) {
      return true;
    }

    // Evaluate each condition
    const conditionResults = rules.conditions.map(condition => {
      const answer = answers[condition.questionKey];
      const operator = this.operators[condition.operator];
      
      if (!operator) {
        console.warn(`Unknown operator: ${condition.operator}`);
        return false;
      }

      // Handle missing answers
      if (answer === undefined || answer === null || answer === '') {
        return false;
      }

      try {
        return operator(answer, condition.value);
      } catch (error) {
        console.error(`Error evaluating condition:`, error);
        return false;
      }
    });

    // Combine results based on logic operator
    if (rules.logic === 'OR') {
      return conditionResults.some(result => result === true);
    }
    
    // Default to AND logic
    return conditionResults.every(result => result === true);
  }

  /**
   * Get visible questions based on current answers
   * @param {Array} questions - Array of question objects
   * @param {Object} answers - Current answers object
   * @returns {Array} - Array of visible questions
   */
  getVisibleQuestions(questions, answers) {
    return questions.filter(question => {
      return this.shouldShowQuestion(question.conditionalRules, answers);
    });
  }

  /**
   * Validate conditional logic configuration
   * @param {Object} rules - Conditional rules object
   * @param {Array} availableQuestions - Available question keys for reference
   * @returns {Object} - Validation result
   */
  validateRules(rules, availableQuestions) {
    if (!rules) {
      return { valid: true };
    }

    const errors = [];

    // Check logic operator
    if (!['AND', 'OR'].includes(rules.logic)) {
      errors.push('Invalid logic operator. Must be AND or OR.');
    }

    // Check conditions array
    if (!Array.isArray(rules.conditions) || rules.conditions.length === 0) {
      errors.push('Conditions array is required and must not be empty.');
      return { valid: false, errors };
    }

    // Validate each condition
    rules.conditions.forEach((condition, index) => {
      if (!condition.questionKey) {
        errors.push(`Condition ${index}: questionKey is required.`);
      } else if (!availableQuestions.includes(condition.questionKey)) {
        errors.push(`Condition ${index}: questionKey "${condition.questionKey}" not found.`);
      }

      if (!condition.operator) {
        errors.push(`Condition ${index}: operator is required.`);
      } else if (!this.operators[condition.operator]) {
        errors.push(`Condition ${index}: invalid operator "${condition.operator}".`);
      }

      if (condition.value === undefined || condition.value === null) {
        errors.push(`Condition ${index}: value is required.`);
      }
    });

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Get questions that affect the visibility of a target question
   * @param {String} targetQuestionKey - The question key to check
   * @param {Array} allQuestions - All questions in the form
   * @returns {Array} - Array of question keys that affect the target
   */
  getDependentQuestions(targetQuestionKey, allQuestions) {
    const dependentQuestions = new Set();
    
    allQuestions.forEach(question => {
      if (question.conditionalRules && question.conditionalRules.conditions) {
        question.conditionalRules.conditions.forEach(condition => {
          if (condition.questionKey === targetQuestionKey) {
            dependentQuestions.add(question.questionKey);
          }
        });
      }
    });
    
    return Array.from(dependentQuestions);
  }

  /**
   * Create a dependency graph for form questions
   * @param {Array} questions - Array of question objects
   * @returns {Object} - Dependency graph
   */
  createDependencyGraph(questions) {
    const graph = {};
    
    questions.forEach(question => {
      graph[question.questionKey] = {
        dependsOn: [],
        dependentBy: []
      };
    });
    
    questions.forEach(question => {
      if (question.conditionalRules && question.conditionalRules.conditions) {
        question.conditionalRules.conditions.forEach(condition => {
          if (graph[condition.questionKey]) {
            graph[condition.questionKey].dependentBy.push(question.questionKey);
            graph[question.questionKey].dependsOn.push(condition.questionKey);
          }
        });
      }
    });
    
    return graph;
  }

  /**
   * Check for circular dependencies in conditional logic
   * @param {Array} questions - Array of question objects
   * @returns {Object} - Detection result
   */
  detectCircularDependencies(questions) {
    const graph = this.createDependencyGraph(questions);
    const visited = {};
    const recursionStack = {};
    const cycles = [];

    const dfs = (node, path) => {
      if (!visited[node]) {
        visited[node] = true;
        recursionStack[node] = true;
        
        const dependencies = graph[node]?.dependentBy || [];
        
        dependencies.forEach(dep => {
          const newPath = [...path, dep];
          
          if (!visited[dep]) {
            dfs(dep, newPath);
          } else if (recursionStack[dep]) {
            cycles.push([...newPath]);
          }
        });
      }
      
      recursionStack[node] = false;
    };

    Object.keys(graph).forEach(node => {
      if (!visited[node]) {
        dfs(node, [node]);
      }
    });

    return {
      hasCycles: cycles.length > 0,
      cycles: cycles
    };
  }
}

module.exports = new ConditionalLogicEngine();