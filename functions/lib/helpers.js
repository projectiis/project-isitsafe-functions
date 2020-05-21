// checks for whether a rating is valid
exports.isRatingValid = rating => {
  if (!Array.isArray(rating) && typeof rating === 'object') {
    if (
      Object.keys(rating).length === 3 &&
      typeof rating.placeId === 'string' &&
      rating.placeId.trim().length > 0 &&
      typeof rating.placeType === 'string' &&
      rating.placeType.trim().length > 0 &&
      !Array.isArray(rating.rules) &&
      typeof rating.rules === 'object' &&
      Object.keys(rating.rules).length > 0
    ) {
      for (let rule in rating.rules) {
        if (typeof rating.rules[rule] !== 'number' || rating.rules[rule] < 0)
          return false;
      }

      return true;
    }
  }

  return false;
};

// validates a rating object against the corresponding schema
exports.ratingHasCorrectSchema = (ratingSchema, ratingRules) => {
  if (!Array.isArray(ratingRules) && typeof ratingRules === 'object') {
    if (Object.keys(ratingRules).length === Object.keys(ratingSchema).length) {
      for (let rule in ratingSchema) {
        if (
          !ratingRules[rule] ||
          ratingRules[rule] > ratingSchema[rule] // each field in the schema holds the maximum value it can accept
        )
          return false;
      }

      return true;
    } else return false;
  } else return false;
};

// calculates the new score per rule and the finalRating
exports.calculateNewScore = (oldRating, newRating, numOfRatings) => {
  const rules = oldRating.rules;
  let finalRating = 0,
    numOfRules = 0;
  for (let rule in rules) {
    rules[rule] = Math.round(
      (rules[rule] * numOfRatings + newRating.rules[rule]) / (numOfRatings + 1),
    );

    finalRating += rules[rule];
    numOfRules += 1;
  }

  finalRating = Math.round(finalRating / numOfRules);

  return { rating: rules, finalRating };
};

// checks for whether a schema is valid
exports.isSchemaValid = schema => {
  if (!Array.isArray(schema) && typeof schema === 'object') {
    for (let rule in schema) {
      if (typeof schema[rule] !== 'number' || ![1, 4].includes(schema[rule]))
        return false;
    }

    return true;
  } else return false;
};
