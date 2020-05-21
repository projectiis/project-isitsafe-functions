const functions = require('firebase-functions');
const admin = require('firebase-admin');

const serviceAccount = require('./lib/isitsafe-276523-25ea13eb6589.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

exports.addRating = functions
  .region('europe-west3')
  .https.onRequest((request, response) => {
    const {
      isRatingValid,
      ratingHasCorrectSchema,
      calculateNewScore,
    } = require('./lib/helpers');

    if (!request.headers.authorization)
      response.json({
        status: 'unauthorized',
        message: 'You need to be singed in to add a rating',
      });
    else {
      admin
        .auth()
        .getUser(request.headers.authorization)
        .then(user => {
          if (!user)
            response.json({
              status: 'unauthorized',
              message: 'You need to be singed in to add a rating',
            });
          else {
            db.collection('ratingRulesSchemas')
              .doc(request.body.placeType)
              .get()
              .then(schema => {
                if (schema.exists) {
                  if (
                    isRatingValid(request.body) &&
                    ratingHasCorrectSchema(schema.data(), request.body.rules)
                  ) {
                    let finalRating = 0,
                      numOfRules = 0;

                    for (let rule in request.body.rules) {
                      // the real range is [0, 100]
                      request.body.rules[rule] *= Math.round(
                        100 / schema.data()[rule],
                      ); // multiply by either 25 or 100
                      finalRating += request.body.rules[rule];
                      ++numOfRules;
                    }

                    finalRating = Math.round(finalRating / numOfRules);

                    const userRating = db.collection('userRatings').doc();
                    const placeRating = db
                      .collection('placeRatings')
                      .doc(request.body.placeId);

                    placeRating
                      .get()
                      .then(res => {
                        const data = res.data();
                        if (res.exists) {
                          const newScore = calculateNewScore(
                            data,
                            request.body,
                            data.numOfRatings,
                          );

                          db.batch()
                            .create(userRating, {
                              userId: request.headers.authorization,
                              ...request.body,
                              finalRating,
                            })
                            .set(
                              placeRating,
                              {
                                // placeType will remain the same
                                rules: newScore.rating,
                                finalRating: newScore.finalRating,
                                numOfRatings: data.numOfRatings + 1,
                              },
                              { merge: true },
                            )
                            .commit()
                            .then(() => response.json({ status: 'ok' }))
                            .catch(() =>
                              response.json({
                                status: 'error_while_updating',
                                message:
                                  'An error occurred while storing your rating',
                              }),
                            );
                        } else {
                          db.batch()
                            .create(userRating, {
                              userId: request.headers.authorization,
                              ...request.body,
                              finalRating,
                            })
                            .create(placeRating, {
                              placeType: request.body.placeType.trim(),
                              rules: request.body.rules,
                              finalRating,
                              numOfRatings: 1,
                            })
                            .commit()
                            .then(() => response.json({ status: 'ok' }))
                            .catch(() =>
                              response.json({
                                status: 'error_while_creating',
                                message:
                                  'An error occurred while storing your rating',
                              }),
                            );
                        }
                      })
                      .catch(() =>
                        response.json({
                          status: 'error',
                          message:
                            'An error occurred while storing your rating',
                        }),
                      );
                  } else {
                    response.json({
                      status: 'invalid_rating',
                      message: 'Invalid rating',
                    });
                  }
                } else {
                  response.json({
                    status: 'invalid_place_type',
                    message: 'Invalid place type',
                  });
                }
              })
              .catch(() =>
                response.json({
                  status: 'error',
                  message: 'An error occurred while storing your rating',
                }),
              );
          }
        })
        .catch(err => {
          response.json({
            status: 'unauthorized',
            message: 'You need to be singed in to add a rating',
          });
        });
    }
  });

exports.getPlaceRating = functions
  .region('europe-west3')
  .https.onRequest((request, response) => {
    if (!(request.query.placeId && request.query.placeType))
      response.json({
        status: 'invalid_request',
        message: 'Invalid request',
      });
    else {
      const placeRatingPromise = db
        .collection('placeRatings')
        .doc(request.query.placeId)
        .get();

      const ratingRulesSchemaPromise = db
        .collection('ratingRulesSchemas')
        .doc(request.query.placeType)
        .get();

      Promise.all([placeRatingPromise, ratingRulesSchemaPromise])
        .then(arrayOfResponses => {
          const placeRating = arrayOfResponses[0];
          const ratingSchema = arrayOfResponses[1];

          if (placeRating.exists && ratingSchema.exists) {
            response.json({
              status: 'ok',
              placeRating: placeRating.data(),
              ratingSchema: ratingSchema.data(),
            });
          } else {
            response.json({
              status: 'no_past_rating',
              message: 'This place has not been rated yet',
            });
          }
        })
        .catch(_ =>
          response.json({
            status: 'error',
            message:
              'An error occurred while retrieving the rating for this place',
          }),
        );
    }
  });

exports.addRatingRulesSchema = functions
  .region('europe-west3')
  .https.onRequest((request, response) => {
    if (request.headers.authorization === serviceAccount.client_id) {
      const { placeType, schema } = request.body;
      if (placeType && schema) {
        const { isSchemaValid } = require('./lib/helpers');

        if (isSchemaValid(schema)) {
          db.collection('ratingRulesSchemas')
            .doc(placeType)
            .create(schema)
            .then(res =>
              response.json({
                status: 'ok',
                message: `Rating schema for placeType: ${placeType} created at ${res.writeTime
                  .toDate()
                  .toTimeString()}`,
              }),
            )
            .catch(_ =>
              response.json({
                status: 'error',
                message: `An error occurred while creating a rating schema for placeType: ${placeType}`,
              }),
            );
        } else
          response.json({
            status: 'invalid_schema',
            message: 'Invalid schema',
          });
      } else
        response.json({
          status: 'invalid_request',
          message: 'Invalid request',
        });
    } else response.json({ status: 'unauthorized' });
  });

exports.updateRatingRulesSchema = functions
  .region('europe-west3')
  .https.onRequest((request, response) => {
    if (request.headers.authorization === serviceAccount.client_id) {
      const { mode, schema, placeType } = request.body;

      if (mode && ['merge', 'replace'].includes(mode) && schema && placeType) {
        const { isSchemaValid } = require('./lib/helpers');

        if (isSchemaValid(schema)) {
          db.collection('ratingRulesSchemas')
            .doc(placeType)
            .set(schema, { merge: mode === 'merge' })
            .then(res =>
              response.json({
                status: 'ok',
                message: `Rating schema for placeType: ${placeType} updated at ${res.writeTime
                  .toDate()
                  .toTimeString()}`,
              }),
            )
            .catch(_ =>
              response.json({
                status: 'error',
                message: `An error occured while trying to update schema for placeType: ${placeType}`,
              }),
            );
        } else
          response.json({
            status: 'invalid_schema',
            message: 'Invalid schema',
          });
      } else
        response.json({
          status: 'invalid_request',
          message: 'Invalid request',
        });
    } else response.send({ status: 'unauthorized' });
  });

exports.getPlaceDetails = functions
  .region('europe-west3')
  .https.onRequest((request, response) => {
    const body = request.body;

    if (
      body.location &&
      body.location.latitude &&
      body.location.longitude &&
      body.placeTypes &&
      Array.isArray(body.placeTypes)
    ) {
      const axios = require('axios').default;
      const { apiKey } = require('./lib/config');
      const requests = [];

      for (let type of body.placeTypes)
        requests.push(
          axios.get(
            `https://maps.googleapis.com/maps/api/place/nearbysearch/json?key=${apiKey}&location=${body.location.latitude},${body.location.longitude}&radius=1500&type=${type}`,
          ),
        );

      axios
        .all(requests)
        .then(
          axios.spread((...searchResponses) => {
            const places = [];
            let searchResultIndex = 0;

            for (let searchResult of searchResponses) {
              const detailsRequests = [];

              if (searchResult.data.status === 'OK') {
                for (let placeInResult of searchResult.data.results) {
                  detailsRequests.push(
                    axios.get(
                      `https://maps.googleapis.com/maps/api/place/details/json?key=${apiKey}&place_id=${placeInResult.place_id}&fields=place_id,formatted_address,geometry,name,international_phone_number,opening_hours`,
                    ),
                  );
                }
              }

              axios
                .all(detailsRequests)
                .then(
                  axios.spread((...detailedResponses) => {
                    let detailedResultIndex = 0;

                    for (let detailedResult of detailedResponses) {
                      let data = detailedResult.data;

                      if (data.status === 'OK') {
                        places.push({
                          address: data.result.formatted_address,
                          coords: {
                            ...data.result.geometry.location,
                          },
                          name: data.result.name,
                          openingHours: data.result.opening_hours,
                          phoneNumber: data.result.international_phone_number,
                          placeId: data.result.place_id,
                          placeType: searchResult.request.path.split(
                            'type=',
                          )[1],
                        });
                      }

                      ++detailedResultIndex;
                    }

                    if (
                      searchResultIndex === searchResponses.length - 1 &&
                      detailedResultIndex === detailedResponses.length
                    )
                      response.json({ status: 'ok', places });

                    ++searchResultIndex;
                  }),
                )
                .catch(_ =>
                  response.json({
                    status: 'details_error',
                    message: 'A network error occurred',
                  }),
                );
            }
          }),
        )
        .catch(_ =>
          response.json({
            status: 'nearbysearch_error',
            message: 'A network error occurred',
          }),
        );
    } else
      response.json({ status: 'invalid_request', message: 'Invalid request' });
  });

exports.getPlaceFromQuery = functions
  .region('europe-west3')
  .https.onRequest((request, response) => {
    const query = request.query;

    if (query.input && query.input.trim().length > 0) {
      const axios = require('axios').default;
      const { apiKey } = require('./lib/config');

      axios
        .get(
          `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?key=${apiKey}&input=${encodeURIComponent(
            query.input,
          )}&inputtype=textquery`,
        )
        .then(res => {
          const data = res.data;
          const requests = [];
          const places = [];

          if (data.status === 'OK') {
            for (let candidate of data.candidates)
              requests.push(
                axios.get(
                  `https://maps.googleapis.com/maps/api/place/details/json?key=${apiKey}&place_id=${candidate.place_id}&fields=place_id,formatted_address,geometry,name,international_phone_number,opening_hours`,
                ),
              );

            axios
              .all(requests)
              .then(
                axios.spread((...responses) => {
                  for (let placeResult of responses) {
                    if (placeResult.data.status === 'OK') {
                      const data = placeResult.data;

                      places.push({
                        address: data.result.formatted_address,
                        coords: {
                          ...data.result.geometry.location,
                        },
                        name: data.result.name,
                        openingHours: data.result.opening_hours,
                        phoneNumber: data.result.international_phone_number,
                        placeId: data.result.place_id,
                      });
                    }
                  }

                  response.json({ status: 'ok', places });
                }),
              )
              .catch(_ =>
                response.json({
                  status: 'details_error',
                  message: 'A network error occurred',
                }),
              );
          } else
            response.json({ status: 'error', message: 'An error occurred' });
        })
        .catch(_ => response.json({ status: 'findplacefromtext_error' }));
    } else
      response.json({
        status: 'invalid_request',
        message: 'You did not enter an input',
      });
  });
